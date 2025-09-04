console.log("✅ Background script running...");

import { fetchMediaFromUrl } from "./media.js";
import { openFacebookAndPost } from "./fb.js";
import {
  getSchedule,
  setSchedule,
  createDailyAlarm,
  clearAllAutoPostAlarms,
  listAutoPostAlarms,
} from "./schedule.js";
import {
  setAutoPostsNode,
  setAutoPostStatus,
  startTriggerListener,
  removeTrigger,
  initFirebaseClient,
  tickAfterPost
} from "../firebase/firebase.js";
import { parseHHMM } from "./time.js";

// ======= Config =======
const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRgvUaPLvI5hb35mqbVASImB5dHZOUtiVVNCqU2L0pxFDRDG1E4YPbLhk_uCCp9yWvWwWJufhjGqnXg/pub?output=csv";

// ------------- init firebase client -------------
initFirebaseClient();

// ------------- Content Script Management -------------
let contentScriptRegistered = false;

async function ensureContentScriptRegistered() {
  if (contentScriptRegistered) return true;
  
  try {
    if (!chrome.scripting?.getRegisteredContentScripts) {
      console.warn("[content] Scripting API not available");
      return false;
    }

    // First unregister any existing scripts
    try {
      await chrome.scripting.unregisterContentScripts({
        ids: ["autoposter-dynamic"]
      });
    } catch (e) {
      // Ignore errors here as the script might not exist
    }

    // Register fresh content script
    await chrome.scripting.registerContentScripts([{
      id: "autoposter-dynamic",
      matches: ["https://*.facebook.com/*"],
      js: ["contentScript.js"],
      runAt: "document_idle",
      world: "ISOLATED"
    }]);

    console.log("[content] Successfully registered content script");
    contentScriptRegistered = true;
    return true;
  } catch (e) {
    console.error("[content] Failed to register content script:", e);
    return false;
  }
}

// Content script registration watchdog
setInterval(async () => {
  if (!contentScriptRegistered) {
    await ensureContentScriptRegistered();
  }
}, 60000);

// Initial registration
ensureContentScriptRegistered();

// ---------- STORAGE HELPERS ----------
function saveCacheToStorage(obj) {
  return new Promise((res) => {
    chrome.storage.local.set({ autoPostsCache: obj }, () => res());
  });
}
function readCacheFromStorage() {
  return new Promise((res) => {
    chrome.storage.local.get(["autoPostsCache"], (items) => {
      res(items.autoPostsCache || {});
    });
  });
}
// ---------- ALARM HELPERS ----------
function alarmNameForRow(rowId) {
  return `autopost_${rowId}`;
}
function parseTimeHHMM(timeStr) {
  if (!timeStr) return null;
  const m = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return { hh, mm };
}
async function createAlarm(rowId, timeStr) {
  try {
    // timeStr example: "15:30" or "20:05"
    const [hourStr, minStr] = timeStr.split(":");
    const hour = parseInt(hourStr, 10);
    const minute = parseInt(minStr, 10);

    if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      console.warn(`[createAlarm] Invalid time string for row ${rowId}:`, timeStr);
      return;
    }

    // Create target date
    const now = new Date();
    const target = new Date();
    target.setHours(hour, minute, 0, 0);

    // If target is in the past, schedule for next day
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }

    // Create alarm with daily repeat
    const alarmName = "autopost_" + rowId;
    await chrome.alarms.create(alarmName, {
      when: target.getTime(),
      periodInMinutes: 1440 // 24 hours = 1440 minutes
    });

    const timeUntilAlarm = Math.round((target.getTime() - now.getTime()) / (1000 * 60));
    console.log(
      `[createAlarm] ✅ Created daily alarm '${alarmName}' for ${hour}:${minute.toString().padStart(2, '0')} ` +
      `(first alarm in ${timeUntilAlarm} minutes)`
    );
  } catch (err) {
    console.error("[createAlarm] ❌ Error:", err);
  }
}

// ===== CSV parser =====
function parseCSV(csv) {
  const rows = [];
  let cur = "",
    row = [],
    inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i],
      next = csv[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === ",") {
      row.push(cur);
      cur = "";
      continue;
    }
    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

// ===== Sync Sheet → RTDB → Cache → Alarms =====

async function fetchAndSync() {
  try {
    console.log("[sync] Bắt đầu đồng bộ từ Sheet:", SHEET_CSV_URL);

    const res = await fetch(SHEET_CSV_URL).catch(err => {
      console.error("[sync] Fetch failed:", err);
      throw err;
    });
    console.log("[sync] Fetch response status:", res.status);
    if (!res.ok) throw new Error("Failed to fetch sheet: " + res.status);

    const csv = await res.text();
    console.log("[sync] CSV length:", csv.length);

    const rows = parseCSV(csv);
    console.log("[sync] parsed rows:", rows.length);

    if (!rows || rows.length < 2) {
      console.warn("[sync] Không có dữ liệu hợp lệ trong sheet.");
      return;
    }

    const updates = {};
    for (let i = 1; i < rows.length; i++) {
      const [rowId, content, time, mediaRaw, statusRaw] = rows[i];
      if (!rowId) continue;
      const mediaUrls = (mediaRaw || "")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
      const status = (statusRaw || "").toLowerCase().includes("đã")
        ? "done"
        : "pending";
      updates[rowId] = {
        rowId,
        content: content || "",
        time: time || "",
        mediaUrls,
        status,
      };
    }

    console.log("[sync] updates built:", updates);

    // 1. Cập nhật Firebase
    await setAutoPostsNode(updates);

    // 2. Lưu cache vào local storage
    await saveCacheToStorage(updates);

    // 3. Lưu schedule để alarm handler đọc
    const jobs = Object.keys(updates).map((k) => updates[k]);
    await setSchedule(jobs);
    console.log("[sync] setSchedule updated with", jobs.length, "jobs");

    // 4. Xóa alarms autopost cũ
    const all = await chrome.alarms.getAll();
    for (const a of all) {
      if (a.name.startsWith("autopost_")) {
        await chrome.alarms.clear(a.name);
      }
    }

    // 5. Tạo alarms mới cho các job pending
    for (const id of Object.keys(updates)) {
      const job = updates[id];
      if (job.time && job.status === "pending") {
        await createAlarm(id, job.time);
      }
    }

    // 6. Gửi message SYNC_DONE cho UI
    chrome.runtime.sendMessage({
      type: "SYNC_DONE",
      payload: updates,
    });

    console.log("[sync] ✅ Updated", Object.keys(updates).length, "jobs");
  } catch (e) {
    console.error("[sync] ❌ Error:", e);
  }
}

// =============== SCHEDULE STORAGE ==================




// schedule periodic sync via chrome alarms
chrome.alarms.create("syncSheet", { periodInMinutes: 5 });

// Track post processing state
let processingPosts = new Set();

// Single alarm listener for all alarms

chrome.alarms.onAlarm.addListener(async (alarm) => {
  // Handle sync alarm
  if (alarm.name === "syncSheet") {
    await fetchAndSync();
    return;
  }

  // Handle post alarms
  if (alarm.name.startsWith("autopost_")) {
    const rowId = alarm.name.replace("autopost_", "");
    
    // Try to acquire processing lock
    const acquired = await processingLock.acquire(rowId);
    if (!acquired) {
      console.log(`[alarm] Already processing post ${rowId}, skipping duplicate trigger`);
      return;
    }
    
    console.log("[alarm] Triggered for rowId:", rowId);

    try {
      const stored = await getSchedule();
      const jobArray = Array.isArray(stored) ? stored : Object.values(stored || {});
      const job = jobArray.find((j) => String(j.rowId) === String(rowId));

      if (!job) {
        console.warn("⚠ No job found in schedule for rowId", rowId);
        return;
      }

      // Double check if job is already done (in case of race conditions)
      if (job.status === "done") {
        console.log(`[alarm] Post ${rowId} already done, skipping`);
        return;
      }

      // Set status to 'processing' in Firebase to prevent duplicates
      await Promise.all([
        setAutoPostStatus(rowId, "processing"),
        updatePostStatusInFirebase(rowId, "processing")
      ]);

      const tabId = await ensureFacebookTab();
      
      // Give Facebook time to fully load
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Clear existing content scripts and inject fresh
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            // Clear any existing state
            window.postingInProgress = false;
            window.currentPostOperation = null;
          }
        });
      } catch (e) {
        console.warn("[alarm] Error clearing content script state:", e);
      }

      const resp = await runPostViaContentScript(tabId, [{
        rowId,
        content: job.content,
        mediaUrls: job.mediaUrls || [],
      }]);

      console.log("[alarm] START_POST resp:", resp);

      if (resp && (resp.success || resp.successCount > 0)) {
        // Update all states in parallel
        await Promise.all([
          setAutoPostStatus(rowId, "done"),
          updatePostStatusInFirebase(rowId, "done"),
          tickAfterPost(rowId).catch(e => console.warn("tickAfterPost err:", e))
        ]);

        // Update local states
        await Promise.all([
          (async () => {
            const current = await getSchedule();
            const newSchedule = (Array.isArray(current) ? current : Object.values(current || {}))
              .map((j) => (String(j.rowId) === String(rowId) ? { ...j, status: "done" } : j));
            await setSchedule(newSchedule);
          })(),
          (async () => {
            const cache = await readCacheFromStorage();
            if (cache && cache[rowId]) cache[rowId].status = "done";
            await saveCacheToStorage(cache);
          })()
        ]);

        console.log(`[alarm] ✅ Post successful & marked done for rowId ${rowId}`);
      } else {
        await Promise.all([
          setAutoPostStatus(rowId, "failed"),
          updatePostStatusInFirebase(rowId, "failed")
        ]);
        console.log(`[alarm] ❌ Post failed for rowId ${rowId}`);
      }
    } catch (err) {
      console.error("[alarm] ❌ Error processing alarm for rowId", rowId, err);
      await Promise.all([
        setAutoPostStatus(rowId, "failed"),
        updatePostStatusInFirebase(rowId, "failed")
      ]).catch(e => console.warn("Error updating failed status:", e));
    } finally {
      processingLock.release(rowId);
    }
  }
});

// Run initial sync on startup
fetchAndSync();

// ===== Alarm Handler for Posting =====
async function ensureFacebookTab() {
  // First check for an existing Facebook tab
  const fbTabs = await chrome.tabs.query({ url: "*://*.facebook.com/*" });
  
  // Filter for main facebook.com tabs (not subdomains)
  const mainFbTabs = fbTabs.filter(tab => 
    tab.url?.match(/^https?:\/\/(www\.)?facebook\.com\//)
  );

  let tab;
  if (mainFbTabs.length > 0) {
    // Use the first Facebook tab found
    tab = mainFbTabs[0];
    // If it's not active, activate it
    if (!tab.active) {
      // Ensure tab.id exists before updating
      if (tab.id) {
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
      }
    }
  } else {
    // No Facebook tab found, create new one
    tab = await chrome.tabs.create({ 
      url: "https://www.facebook.com/me",
      active: true 
    });
  }

  // Wait for the tab to be fully loaded
  const tabId = tab.id;
  console.log("[AutoPoster] Waiting for Facebook tab to load:", tabId);
  
  const maxWaitTime = 30000; // 30 seconds
  const start = Date.now();
  
  while (Date.now() - start < maxWaitTime) {
    try {
      const currentTab = await chrome.tabs.get(tabId);
      
      // Check if the page is fully loaded
      if (currentTab.status === "complete") {
        // Additional check: try to ping the content script
        try {
          const response = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(false), 2000);
            chrome.tabs.sendMessage(tabId, { type: "PING" }, (response) => {
              clearTimeout(timeout);
              resolve(response);
            });
          });
          
          if (response && response.ready) {
            console.log("[AutoPoster] Facebook tab ready and content script responding");
            // Give the page a little more time to fully initialize
            await new Promise(r => setTimeout(r, 2000));
            return tabId;
          }
        } catch (e) {
          // Content script not ready yet, continue waiting
        }
      }
      
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.warn("[AutoPoster] Error checking tab status:", e);
      break;
    }
  }
  
  // If we get here, the tab is either loaded or we timed out
  console.log("[AutoPoster] Facebook tab load complete or timeout reached");
  return tabId;
}

async function runPostViaContentScript(tabId, posts) {
  await chrome.storage.local.set({ postsToPost: posts });

  // Helper to inject content script and verify it's working
  const injectAndVerifyContentScript = async () => {
    console.log("[content] Starting content script injection...");

    // First ensure content script is registered
    await ensureContentScriptRegistered();

    // Then clear any existing state
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // Clear all window state
          if (window.postingInProgress) delete window.postingInProgress;
          if (window.currentPostOperation) delete window.currentPostOperation;
          
          // Remove known listeners
          const knownListeners = ['__autoPostBeforeUnload', '__autoPostVisibilityChange'];
          for (const listener of knownListeners) {
            if (window[listener]) {
              window.removeEventListener('beforeunload', window[listener]);
              window.removeEventListener('visibilitychange', window[listener]);
              delete window[listener];
            }
          }
        }
      });
    } catch (e) {
      console.warn("[content] Error clearing state:", e);
      // Continue anyway as this is just cleanup
    }

    // Inject fresh content script
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["contentScript.js"]
      });
      console.log("[content] Content script injected");
    } catch (e) {
      console.error("[content] Script injection failed:", e);
      return false;
    }

    // Verify script is working
    try {
      const response = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 3000);
        chrome.tabs.sendMessage(tabId, { type: "PING" }, (response) => {
          clearTimeout(timeout);
          resolve(response);
        });
      });

      if (response?.ready) {
        console.log("[content] Content script verified working");
        return true;
      }
    } catch (e) {
      console.warn("[content] Script verification failed:", e);
    }

    return false;
  };

  // Try multiple times to get the content script working
  const maxAttempts = 5;
  let scriptReady = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[content] Attempt ${attempt}/${maxAttempts} to initialize content script`);
    
    scriptReady = await injectAndVerifyContentScript();
    
    if (scriptReady) {
      console.log("[content] Content script successfully initialized");
      break;
    }

    if (attempt < maxAttempts) {
      // Wait between attempts
      console.log("[content] Waiting before retry...");
      await new Promise(r => setTimeout(r, 2000));
      
      // Verify tab is still valid before retrying
      try {
        await chrome.tabs.get(tabId);
      } catch (e) {
        console.error("[content] Tab no longer exists:", e);
        return { success: false, message: "Tab was closed" };
      }
    }
  }

  if (!scriptReady) {
    console.error("[content] Failed to initialize content script after", maxAttempts, "attempts");
    return { success: false, message: "Could not initialize content script" };
  }

  // Send post request with enhanced error handling
  const sendPostRequest = async () => {
    // Verify tab is still valid
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url?.includes('facebook.com')) {
        console.error("[content] Tab is no longer on Facebook");
        return { success: false, message: "Tab navigated away from Facebook" };
      }
    } catch (e) {
      console.error("[content] Tab validation failed:", e);
      return { success: false, message: "Tab no longer exists" };
    }

    // Enhanced content script verification and message sending
    const maxRetries = 3;
    const retryDelay = 2000; // 2 seconds between retries
    let lastError = null;

    // Helper function to verify content script is working
    const verifyContentScript = async (tabId) => {
      try {
        const response = await new Promise((resolve) => {
          const timeout = setTimeout(() => resolve(false), 5000);
          chrome.tabs.sendMessage(tabId, { type: "PING" }, (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
              resolve(false);
            } else {
              resolve(response?.ready === true);
            }
          });
        });
        return response;
      } catch (e) {
        return false;
      }
    };

    // Helper function to inject content script
    const injectContentScript = async (tabId) => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content/index.js']
        });
        // Wait a bit for script to initialize
        await new Promise(r => setTimeout(r, 500));
        return true;
      } catch (e) {
        console.error("[content] Script injection failed:", e);
        return false;
      }
    };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[content] Starting attempt ${attempt}/${maxRetries}`);
        
        // First verify content script is working
        const isWorking = await verifyContentScript(tabId);
        if (!isWorking) {
          console.log("[content] Content script not responding, injecting...");
          const injected = await injectContentScript(tabId);
          if (!injected) {
            throw new Error("Content script injection failed");
          }
          
          // Verify injection worked
          const verified = await verifyContentScript(tabId);
          if (!verified) {
            throw new Error("Content script verification failed after injection");
          }
        }
        
        // Now send the actual message
        const response = await new Promise((resolve) => {
          const timeoutDuration = 30000;
          const timeout = setTimeout(() => {
            resolve({ success: false, message: "Request timed out" });
          }, timeoutDuration);

          chrome.tabs.sendMessage(tabId, { 
            type: "START_POST",
            posts: posts,
            timestamp: Date.now()
          }, (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
              console.warn("[content] Message error:", chrome.runtime.lastError);
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(response);
            }
          });
        });

        if (response && (response.success || response.successCount > 0)) {
          console.log("[content] Post request succeeded");
          return response;
        }

        lastError = response.message || response.error || "Unknown error";
        console.warn(`[content] Attempt ${attempt} failed:`, lastError);

        if (attempt < maxRetries) {
          // Wait before retry and verify script is still working
          await new Promise(r => setTimeout(r, 2000));
          const stillWorking = await injectAndVerifyContentScript();
          if (!stillWorking) {
            console.error("[content] Content script stopped working");
            return { success: false, message: "Content script malfunction" };
          }
        }
      } catch (e) {
        lastError = String(e);
        console.error(`[content] Error in attempt ${attempt}:`, e);
      }
    }

    return { 
      success: false, 
      message: `Failed after ${maxRetries} attempts. Last error: ${lastError}` 
    };
  };

  return sendPostRequest();
}

// ================== Alarm Handler ==================
// Track post processing state with improved locking mechanism
const processingLock = {
  _posts: new Set(),
  acquire: async (rowId) => {
    if (processingLock._posts.has(rowId)) {
      return false;
    }
    processingLock._posts.add(rowId);
    return true;
  },
  release: (rowId) => {
    processingLock._posts.delete(rowId);
  }
};

// Single unified alarm listener for all alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  // Handle sync alarm
  if (alarm.name === "syncSheet") {
    await fetchAndSync();
    return;
  }

  // Handle post alarms
  if (alarm.name.startsWith("autopost_")) {
    const rowId = alarm.name.replace("autopost_", "");
    
    // Try to acquire processing lock
    const acquired = await processingLock.acquire(rowId);
    if (!acquired) {
      console.log(`[alarm] Already processing post ${rowId}, skipping duplicate trigger`);
      return;
    }
    
    console.log("[alarm] Triggered for rowId:", rowId);

    try {
      const stored = await getSchedule();
      const jobArray = Array.isArray(stored) ? stored : Object.values(stored || {});
      const job = jobArray.find((j) => String(j.rowId) === String(rowId));

      if (!job) {
        console.warn("⚠ No job found in schedule for rowId", rowId);
        return;
      }

      // Double check if job is already done (in case of race conditions)
      if (job.status === "done") {
        console.log(`[alarm] Post ${rowId} already done, skipping`);
        return;
      }

      // Set status to 'processing' in Firebase to prevent duplicates
      await Promise.all([
        setAutoPostStatus(rowId, "processing"),
        updatePostStatusInFirebase(rowId, "processing")
      ]);

      const tabId = await ensureFacebookTab();
      
      // Give Facebook time to fully load
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Clear existing content scripts and inject fresh
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            // Clear any existing state
            window.postingInProgress = false;
            window.currentPostOperation = null;
          }
        });
      } catch (e) {
        console.warn("[alarm] Error clearing content script state:", e);
      }

      const resp = await runPostViaContentScript(tabId, [{
        rowId,
        content: job.content,
        mediaUrls: job.mediaUrls || [],
      }]);

      console.log("[alarm] START_POST resp:", resp);

      if (resp && (resp.success || resp.successCount > 0)) {
        // Update all states in parallel
        await Promise.all([
          setAutoPostStatus(rowId, "done"),
          updatePostStatusInFirebase(rowId, "done"),
          tickAfterPost(rowId).catch(e => console.warn("tickAfterPost err:", e))
        ]);

        // Update local states
        await Promise.all([
          (async () => {
            const current = await getSchedule();
            const newSchedule = (Array.isArray(current) ? current : Object.values(current || {}))
              .map((j) => (String(j.rowId) === String(rowId) ? { ...j, status: "done" } : j));
            await setSchedule(newSchedule);
          })(),
          (async () => {
            const cache = await readCacheFromStorage();
            if (cache && cache[rowId]) cache[rowId].status = "done";
            await saveCacheToStorage(cache);
          })()
        ]);

        console.log(`[alarm] ✅ Post successful & marked done for rowId ${rowId}`);
      } else {
        await Promise.all([
          setAutoPostStatus(rowId, "failed"),
          updatePostStatusInFirebase(rowId, "failed")
        ]);
        console.log(`[alarm] ❌ Post failed for rowId ${rowId}`);
      }
    } catch (err) {
      console.error("[alarm] ❌ Error processing alarm for rowId", rowId, err);
      await Promise.all([
        setAutoPostStatus(rowId, "failed"),
        updatePostStatusInFirebase(rowId, "failed")
      ]).catch(e => console.warn("Error updating failed status:", e));
    } finally {
      processingLock.release(rowId);
    }
  }
});




// ===== Remote Trigger from RTDB =====
startTriggerListener(async (trigger) => {
  if (!trigger || !trigger.rowId) return;
  try {
    await openFacebookAndPost([
      {
        rowId: trigger.rowId,
        content: trigger.content,
        mediaUrls: trigger.mediaUrls || [],
      },
    ]);
    await setAutoPostStatus(trigger.rowId, "done");
    updatePostStatusInFirebase(trigger.rowId, "done");
    try { await tickAfterPost(trigger.rowId); } catch (e) { console.warn("tickAfterPost err:", e); } // <--- thêm dòng này
    await removeTrigger(trigger.rowId);
  } catch (err) {
    console.error("[trigger] Error processing trigger", trigger.rowId, err);
    await setAutoPostStatus(trigger.rowId, "failed");
    updatePostStatusInFirebase(trigger.rowId, "failed");
  }
});



function updatePostStatusInFirebase(rowId, status) {
  const dbUrl = `https://autopostermmo-default-rtdb.firebaseio.com/autoPosts/${rowId}.json`;

  fetch(dbUrl, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  })
    .then((res) => res.json())
    .then((data) => {
      console.log(`[Firebase] ✅ Updated rowId=${rowId} to status=${status}`, data);

      // Gửi log cho popup UI
      chrome.runtime.sendMessage({ type: "STATUS_LOG", rowId, status });
    })
    .catch((err) => {
      console.error(`[Firebase] ❌ Failed to update status for rowId=${rowId}`, err);
    });
}

// ======= FIXED MESSAGE LISTENER - NO DUPLICATES =======
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log("[Background] Received message:", message.type);

  (async () => {
    try {
      if (message.type === "FETCH_MEDIA") {
        const result = await fetchMediaFromUrl(message.url);
        sendResponse(result);
        return;
      }

      if (message.type === "DOWNLOAD_MEDIA" && typeof message.url === "string") {
        try {
          const res = await fetch(message.url);
          if (!res.ok)
            throw new Error(`Fetch failed with status ${res.status}`);
          const contentType =
            res.headers.get("content-type") || "application/octet-stream";
          const buffer = await res.arrayBuffer();
          const u8 = new Uint8Array(buffer);
          let binary = "";
          const chunkSize = 0x8000;
          for (let i = 0; i < u8.length; i += chunkSize) {
            binary += String.fromCharCode(...u8.subarray(i, i + chunkSize));
          }
          const b64 = btoa(binary);
          sendResponse({
            success: true,
            data: `data:${contentType};base64,${b64}`,
            type: contentType,
          });
        } catch (err) {
          console.error("[AutoPoster] DOWNLOAD_MEDIA fetch error:", err);
          sendResponse({ success: false, error: String(err) });
        }
        return;
      }

      if (message.type === "START_POST") {
        openFacebookAndPost(message.posts);
        sendResponse({ message: "🚀 Đang đăng bài...." });
        return;
      }

      // --- Sync from Google Sheet (moved to top-level listener) ---
      if (message.type === "SYNC_FROM_SHEET") {
        console.log("[Background] SYNC_FROM_SHEET triggered");
        try {
          await fetchAndSync();
          sendResponse({ success: true, message: "✅ Sheet sync completed successfully" });
        } catch (error) {
          console.error("[Background] SYNC_FROM_SHEET error:", error);
          sendResponse({ success: false, message: "❌ Sheet sync failed: " + error.message });
        }
        return;
      }

      if (message.type === "SET_SCHEDULE") {
        const raw = message.schedule || [];
        const valid = raw.filter((x) => parseHHMM(x.time));
        await setSchedule(valid);
        await clearAllAutoPostAlarms();
        for (const item of valid) await createDailyAlarm(item.time);
        sendResponse({
          message: `✅ Đã đặt ${valid.length} lịch (lặp hàng ngày).`,
        });
        return;
      }

      if (message.type === "ADD_SCHEDULE_ITEM") {
        const { item } = message;
        if (!item || !parseHHMM(item.time)) {
          sendResponse({ message: "⚠ Giờ không hợp lệ." });
          return;
        }
        const current = await getSchedule();
        current.push(item);
        await setSchedule(current);
        await createDailyAlarm(item.time);
        sendResponse({ message: "✅ Đã thêm lịch." });
        return;
      }

      if (message.type === "CLEAR_SCHEDULE") {
        await setSchedule([]);
        await clearAllAutoPostAlarms();
        sendResponse({ message: "🗹 Đã xóa toàn bộ lịch & alarms." });
        return;
      }


      if (message.type === "LIST_ALARMS") {
        const all = await chrome.alarms.getAll();
        const list = all
          .filter((a) => a.name.startsWith("autopost_") || a.name.startsWith("AUTOPOST|"))
          .map((a) => `${a.name} -> ${new Date(a.scheduledTime).toLocaleString()}`);
        console.log("Current alarms:", list);
        sendResponse({ alarms: list });
        return;
      }

      if (message.type === "POST_DONE" && message.rowId) {
        await setAutoPostStatus(message.rowId, "done");
        // keep Firebase in sync as well
        updatePostStatusInFirebase(message.rowId, message.status || "done");
        sendResponse({ ok: true, message: `✅ Updated status for ${message.rowId}` });
        return;
      }

      if (message.type === "DEBUG_DIALOGS") {
        // Debug function to check what dialogs are available on Facebook
        try {
          const tabs = await chrome.tabs.query({ url: "https://*.facebook.com/*" });
          if (tabs.length === 0) {
            sendResponse({ error: "No Facebook tabs found" });
            return;
          }
          
          const tab = tabs[0];
          const response = await chrome.tabs.sendMessage(tab.id, { type: "DEBUG_DIALOGS" });
          sendResponse(response);
        } catch (error) {
          console.error("[Background] DEBUG_DIALOGS error:", error);
          sendResponse({ error: String(error) });
        }
        return;
      }

      // Default case for unknown message types
      sendResponse({ message: "⚠ Unknown message type: " + message.type });
    } catch (error) {
      console.error("🔥 Background error:", error);
      sendResponse({
        ok: false,
        message: "⚠ Lỗi: " + (error?.message || error),
        error: error?.message || String(error),
      });
    }
  })();

  chrome.alarms.getAll().then(a => console.log("Current alarms:", a));

  return true;
});





// ======= Bắt sự kiện tới giờ =======
/*
/* Khi báo thức nổ, lấy item tương ứng HH:mm, gọi openFacebookAndPost([{content, mediaUrls}]) 
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm?.name?.startsWith(ALARM_PREFIX)) return;
  const hhmm = alarm.name.substring(ALARM_PREFIX.length);
  console.log("⏰ Alarm fired:", alarm.name, "->", hhmm);
  const schedule = await getSchedule();
  const item = schedule.find((s) => s.time === hhmm);
  if (!item) {
    console.warn("⚠️ Không tìm thấy content cho", hhmm);
    return;
  }
  console.log("🎯 Auto posting at", hhmm, ":", {
    content: item.content?.substring(0, 50),
    mediaUrls: item.mediaUrls,
  });
  openFacebookAndPost([
    { content: item.content, mediaUrls: item.mediaUrls || [] },
  ]);
});
initializeFirebaseSync(async (jobs) => {
  await clearAllAutoPostAlarms();
  for (const job of jobs) {
    if (job.status === "pending" && job.time) {
      await createDailyAlarm(job.time);
    }
  }
  console.log(`✅ Synced ${jobs.length} jobs and alarms created`);
});
*/