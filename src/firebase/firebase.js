// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  set,
  onChildAdded,
  remove, 
  get,
  child,
} from "firebase/database";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDc4m_kk6RMWKrOtsMErgWjueMdgftyypg",
  authDomain: "autopostermmo.firebaseapp.com",
  databaseURL: "https://autopostermmo-default-rtdb.firebaseio.com",
  projectId: "autopostermmo",
  storageBucket: "autopostermmo.firebasestorage.app",
  messagingSenderId: "916563696851",
  appId: "1:916563696851:web:0d724dac43a21adc840826",
};

let firebaseApp = null;
let db = null;

 // Khởi tạo Firebase client (gọi một lần trong background script)
export function initFirebaseClient() {
  if (firebaseApp) return { app: firebaseApp, db };
  firebaseApp = initializeApp(firebaseConfig);
  db = getDatabase(firebaseApp);
  console.log("[Firebase] initialized (client)");
  return { app: firebaseApp, db };
}

export function getDb() {
  if (!db) initFirebaseClient();
  return db;
}

/**
 * Ghi toàn bộ node autoPosts (overwrite) - dùng khi sync sheet -> RTDB
 * updates: object with keys = rowId, values = { rowId, content, time, mediaUrls, status }
 */
export async function setAutoPostsNode(updates) {
  console.log("[Firebase] Writing to autoPosts:", updates);
  const db = getDb();
  await set(ref(db, "autoPosts"), updates);
    console.log("[Firebase] ✅ Write complete");
}

/**
 * Set status for specific post row
 */

export async function setAutoPostStatus(rowId, status) {
  if (!rowId) return;
  const db = getDb();
  await set(ref(db, `autoPosts/${rowId}/status`), status);
}
export async function saveCache(data) {
  return new Promise((res) => {
    chrome.storage.local.set({ autoPostsCache: data }, () => res());
  });
}

/**
 * Start listening for triggers/child_added.
 * If cb provided, call cb(triggerObject). Otherwise log.
 * Trigger object expected shape: { rowId, content, mediaUrls, createdAt }
 */

export function startTriggerListener(cb) {
  const db = getDb();
  const triggersRef = ref(db, "triggers");
  onChildAdded(triggersRef, (snap) => {
    const data = snap.val();
    console.log("[Firebase] trigger child_added:", data);
    if (typeof cb === "function") {
      (async () => {
        try {
          await cb(data);
        } catch (e) {
          console.error("[startTriggerListener] cb error:", e);
        }
      })();
    } else {
      console.log("[startTriggerListener] no callback passed; ignoring trigger.");
    }
  });
}


/**
 * Utility: remove a trigger by rowId
 */
export async function removeTrigger(rowId) {
  const db = getDb();
  try {
    await remove(ref(db, `triggers/${rowId}`));
  } catch (e) {
    console.error("[Firebase] removeTrigger failed:", e);
  }
}
/**
 * Utility: read autoPosts once (useful for debugging)
 */
export async function readAutoPostsOnce() {
  const db = getDb();
  const rootRef = ref(db, "/");
  const snapshot = await get(child(rootRef, "autoPosts"));
  return snapshot.exists() ? snapshot.val() : null;
}

const MARK_POSTED_URL = "https://asia-southeast1-autopostermmo.cloudfunctions.net/markPosted";

export async function tickAfterPost(rowId) {
  const maxTries = 3;
  let attempt = 0;
  let ok = false;
  while (attempt < maxTries && !ok) {
    try {
      attempt++;
      const response = await fetch(MARK_POSTED_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowId }),
      });
      const result = await response.json();
      if (result.ok) {
        ok = true;
        console.log(`✅ markPosted success for rowId: ${rowId}`);
      } else {
        console.error(`❌ markPosted failed:`, result.error);
      }
    } catch (err) {
      console.error("❌ Error calling markPosted:", err);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  return ok;
}


/*
// Initialize Firebase
/*
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export function initializeFirebaseSync(onJobsUpdate) {
  const postsRef = ref(db, "autoPosts");
  onValue(postsRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) return;
    const jobs = Object.keys(data).map((k) => ({ rowId: k, ...data[k] }));
    chrome.storage.local.set({ schedule: jobs });
    onJobsUpdate(jobs);
  });
}
const MARK_POSTED_URL =
  "https://asia-southeast1-autopostermmo.cloudfunctions.net/markPosted";


export function startTriggerListener() {
  onChildAdded(ref(db, "triggers"), async (snap) => {
    const job = snap.val();
    console.log("[AutoPoster] New trigger:", job);
    let success = false;
    try {
      success = await postContentToFacebook(job.content, job.mediaUrls);
    } catch (err) {
      console.error("[AutoPoster] Error posting:", err);
    }

    // Notify extension UI / background listeners
    try {
      chrome.runtime.sendMessage({
        type: "NOTIFY_POST_RESULT",
        success: !!success,
        rowId: job.rowId,
        content: job.content,
      });
    } catch (e) {
      console.warn("[startTriggerListener] chrome.runtime.sendMessage failed", e);
    }

    if (success) {
      await tickAfterPost(job.rowId);
      console.log(`[AutoPoster] Processed trigger ${job.rowId}`);
    } else {
      console.warn(`[AutoPoster] Failed to post ${job.rowId} - leaving for analysis`);
      // optional: set a flag in DB so you can re-run or alert
      await set(ref(db, `autoPosts/${job.rowId}/status`), "failed");
    }

    // Clean trigger node
    try {
      await remove(ref(db, `triggers/${job.rowId}`));
    } catch (e) {
      console.error("[startTriggerListener] remove trigger failed:", e);
    }
  });
}

*/