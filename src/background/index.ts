console.log("✅ Background script running...");

// Import statements
import { openFacebookAndPost } from "./fb";
import { getSchedule, setSchedule, setAutoPostStatus, tickAfterPost } from "./schedule";
import { setAutoPostsNode, startTriggerListener, removeTrigger } from "../firebase/firebase";
import type { TriggerData } from "../types";
import type { 
  PostJob, 
  PostResponse, 
  CacheData, 
  ContentScriptMessage,
  ContentScriptResponse,
  ProcessingLock
} from "../types";

// Extend window interface for posting state
declare global {
  interface Window {
    postingInProgress?: boolean;
    currentPostOperation?: string | null;
  }
}

// ======= Config =======
const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRgvUaPLvI5hb35mqbVASImB5dHZOUtiVVNCqU2L0pxFDRDG1E4YPbLhk_uCCp9yWvWwWJufhjGqnXg/pub?output=csv";

// ------------- Firebase initialization -------------
// Firebase client is initialized in firebase.ts

// ------------- Content Script Management -------------
let contentScriptRegistered = false;

async function ensureContentScriptRegistered(): Promise<boolean> {
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
    } catch {
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
  } catch (e: unknown) {
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
function saveCacheToStorage(obj: CacheData): Promise<void> {
  return new Promise((res) => {
    chrome.storage.local.set({ autoPostsCache: obj }, () => res());
  });
}

function readCacheFromStorage(): Promise<CacheData> {
  return new Promise((res) => {
    chrome.storage.local.get(["autoPostsCache"], (items) => {
      res(items.autoPostsCache || {});
    });
  });
}

// ---------- ALARM HELPERS ----------

async function createAlarm(rowId: string, timeStr: string): Promise<void> {
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
function parseCSV(csv: string): string[][] {
  const rows: string[][] = [];
  let cur = "",
    row: string[] = [],
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
async function fetchAndSync(): Promise<void> {
  try {
    console.log("[sync] Bắt đầu đồng bộ từ Sheet:", SHEET_CSV_URL);

    const res = await fetch(SHEET_CSV_URL).catch((err: unknown) => {
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

    const updates: CacheData = {};
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
        status: status as PostJob['status'],
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
  } catch (e: unknown) {
    console.error("[sync] ❌ Error:", e);
  }
}

// schedule periodic sync via chrome alarms
chrome.alarms.create("syncSheet", { periodInMinutes: 5 });

// Track post processing state with improved locking mechanism
const processingLock: ProcessingLock = {
  _posts: new Set<string>(),
  acquire: async (rowId: string): Promise<boolean> => {
    if (processingLock._posts.has(rowId)) {
      return false;
    }
    processingLock._posts.add(rowId);
    return true;
  },
  release: (rowId: string): void => {
    processingLock._posts.delete(rowId);
  }
};

// ===== Alarm Handler for Posting =====
async function ensureFacebookTab(): Promise<number> {
  // First check for an existing Facebook tab
  const fbTabs = await chrome.tabs.query({ url: "*://*.facebook.com/*" });
  
  // Filter for main facebook.com tabs (not subdomains)
  const mainFbTabs = fbTabs.filter(tab => 
    tab.url?.match(/^https?:\/\/(www\.)?facebook\.com\//)
  );

  let tab: chrome.tabs.Tab;
  if (mainFbTabs.length > 0) {
    // Use the first Facebook tab found
    tab = mainFbTabs[0];
    // If it's not active, activate it
    if (!tab.active && tab.id) {
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId) {
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
  const tabId = tab.id!;
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
          const response = await new Promise<ContentScriptResponse>((resolve) => {
            const timeout = setTimeout(() => resolve({ ready: false }), 2000);
            chrome.tabs.sendMessage(tabId, { type: "PING" }, (response: ContentScriptResponse) => {
              clearTimeout(timeout);
              resolve(response || { ready: false });
            });
          });
          
          if (response && response.ready) {
            console.log("[AutoPoster] Facebook tab ready and content script responding");
            // Give the page a little more time to fully initialize
            await new Promise(r => setTimeout(r, 2000));
            return tabId;
          }
        } catch {
          // Content script not ready yet, continue waiting
        }
      }
      
      await new Promise(r => setTimeout(r, 1000));
    } catch (e: unknown) {
      console.warn("[AutoPoster] Error checking tab status:", e);
      break;
    }
  }
  
  // If we get here, the tab is either loaded or we timed out
  console.log("[AutoPoster] Facebook tab load complete or timeout reached");
  return tabId;
}

async function runPostViaContentScript(tabId: number, posts: PostJob[]): Promise<PostResponse> {
  await chrome.storage.local.set({ postsToPost: posts });

  // Enhanced content script initialization with better error handling
  const maxAttempts = 5;
  let scriptReady = false;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[content] Attempt ${attempt}/${maxAttempts} to initialize content script`);
    
    try {
      // Verify tab is still valid and on Facebook
      const tab = await chrome.tabs.get(tabId);
      if (!tab?.url?.includes('facebook.com')) {
        lastError = "Tab not on Facebook";
        console.error("[content] Tab validation failed:", lastError);
        return { success: false, message: lastError };
      }

      // Clear any existing content script
      try {
        await chrome.scripting.unregisterContentScripts({
          ids: ["autoposter-dynamic"]
        });
      } catch {
        // Ignore unregister errors
      }

      // Wait a moment for cleanup
      await new Promise(r => setTimeout(r, 500));
      
      // Register content script
      await chrome.scripting.registerContentScripts([{
        id: "autoposter-dynamic",
        matches: ["https://*.facebook.com/*"],
        js: ["contentScript.js"],
        runAt: "document_idle",
        world: "ISOLATED"
      }]);

      // Give the script time to initialize
      await new Promise(resolve => setTimeout(resolve, 1000));
      scriptReady = true;
      console.log("[content] Content script successfully initialized");
      break;

    } catch (err: unknown) {
      lastError = (err as Error).message || String(err);
      console.error(`[content] Error in attempt ${attempt}:`, err);
      
      if ((err as Error).message?.includes("No tab with id")) {
        return { success: false, message: "Tab was closed" };
      }

      // Wait before next attempt if not last try
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  if (!scriptReady) {
    console.error("[content] Failed to initialize content script after", maxAttempts, "attempts");
    return { success: false, message: "Could not initialize content script" };
  }

  // Send post request with enhanced error handling
  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[content] Starting attempt ${attempt}/${maxRetries}`);
      
      // Verify tab is still valid
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url?.includes('facebook.com')) {
        console.error("[content] Tab is no longer on Facebook");
        return { success: false, message: "Tab navigated away from Facebook" };
      }
      
      // Send the actual message
      const response = await new Promise<PostResponse>((resolve) => {
        const timeoutDuration = 30000;
        const timeout = setTimeout(() => {
          resolve({ success: false, message: "Request timed out" });
        }, timeoutDuration);

        chrome.tabs.sendMessage(tabId, { 
          type: "START_POST",
          posts: posts,
          timestamp: Date.now()
        } as ContentScriptMessage, (response: PostResponse) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            console.warn("[content] Message error:", chrome.runtime.lastError);
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response);
          }
        });
      });

      if (response && (response.success || (response.successCount && response.successCount > 0))) {
        console.log("[content] Post request succeeded");
        return response;
      }

      lastError = response.message || response.error || "Unknown error";
      console.warn(`[content] Attempt ${attempt} failed:`, lastError);

      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e: unknown) {
      lastError = String(e);
      console.error(`[content] Error in attempt ${attempt}:`, e);
    }
  }

  return { 
    success: false, 
    message: `Failed after ${maxRetries} attempts. Last error: ${lastError}` 
  };
}

async function updatePostStatusInFirebase(rowId: string, status: PostJob['status'], attempt = 1): Promise<void> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 2000;
  const dbUrl = `https://autopostermmo-default-rtdb.firebaseio.com/autoPosts/${rowId}.json`;

  try {
    console.log(`[Firebase] Updating status for rowId=${rowId} (attempt ${attempt}/${MAX_RETRIES})`);

    const response = await fetch(dbUrl, {
      method: "PATCH",
      headers: { 
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({ status }),
      cache: 'no-cache'
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    console.log(`[Firebase] ✅ Successfully updated status for rowId=${rowId} to ${status}`);
  } catch (error: unknown) {
    console.error(`[Firebase] ❌ Error updating status (attempt ${attempt}):`, error);
    
    if (attempt < MAX_RETRIES) {
      console.log(`[Firebase] Retrying in ${RETRY_DELAY}ms...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return updatePostStatusInFirebase(rowId, status, attempt + 1);
    } else {
      console.error(`[Firebase] ❌ Failed to update status after ${MAX_RETRIES} attempts`);
      throw error;
    }
  }
}

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
      const jobArray = Array.isArray(stored) ? stored : Object.values(stored || {}) as PostJob[];
      const job = jobArray.find((j: PostJob) => String(j.rowId) === String(rowId));

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
      } catch (e: unknown) {
        console.warn("[alarm] Error clearing content script state:", e);
      }

      const resp = await runPostViaContentScript(tabId, [{
        rowId,
        content: job?.content || '',
        mediaUrls: job?.mediaUrls || [],
        time: job?.time || '',
        status: job?.status || 'pending'
      }]);

      console.log("[alarm] START_POST resp:", resp);

      if (resp && (resp.success || (resp.successCount && resp.successCount > 0))) {
        // Update all states in parallel
        await Promise.all([
          setAutoPostStatus(rowId, "done"),
          updatePostStatusInFirebase(rowId, "done"),
          tickAfterPost(rowId).catch((e: Error) => console.warn("tickAfterPost err:", e))
        ]);

        // Update local states
        await Promise.all([
          (async () => {
            const current = await getSchedule();
            const newSchedule = (Array.isArray(current) ? current : Object.values(current || {}) as PostJob[])
              .map((j: PostJob) => (String(j.rowId) === String(rowId) ? { ...j, status: "done" as const } : j));
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
    } catch (err: unknown) {
      console.error("[alarm] ❌ Error processing alarm for rowId", rowId, err);
      await Promise.all([
        setAutoPostStatus(rowId, "failed"),
        updatePostStatusInFirebase(rowId, "failed")
      ]).catch((e: unknown) => console.warn("Error updating failed status:", e));
    } finally {
      processingLock.release(rowId);
    }
  }
});

// Run initial sync on startup
fetchAndSync();

// ===== Remote Trigger from RTDB =====
startTriggerListener(async (trigger: TriggerData) => {
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
    try { await tickAfterPost(trigger.rowId); } catch (e: unknown) { console.warn("tickAfterPost err:", e); }
    await removeTrigger(trigger.rowId);
  } catch (err: unknown) {
    console.error("[trigger] Error processing trigger", trigger.rowId, err);
    await setAutoPostStatus(trigger.rowId, "failed");
    updatePostStatusInFirebase(trigger.rowId, "failed");
  }
});
