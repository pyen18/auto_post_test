// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import type { FirebaseApp } from "firebase/app";
import {
  getDatabase,
  ref,
  set,
  onChildAdded,
  remove, 
  get,
  child,
  Database,
  DataSnapshot,
} from "firebase/database";

// Types
interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

interface AutoPost {
  rowId: string;
  content: string;
  time: string;
  mediaUrls: string[];
  status: 'pending' | 'processing' | 'done' | 'failed';
}

interface AutoPostsUpdates {
  [rowId: string]: AutoPost;
}

interface TriggerData {
  rowId: string;
  content: string;
  mediaUrls?: string[];
  createdAt?: number;
}

interface MarkPostedResponse {
  ok: boolean;
  error?: string;
}

// Your web app's Firebase configuration
const firebaseConfig: FirebaseConfig = {
  apiKey: "AIzaSyDc4m_kk6RMWKrOtsMErgWjueMdgftyypg",
  authDomain: "autopostermmo.firebaseapp.com",
  databaseURL: "https://autopostermmo-default-rtdb.firebaseio.com",
  projectId: "autopostermmo",
  storageBucket: "autopostermmo.firebasestorage.app",
  messagingSenderId: "916563696851",
  appId: "1:916563696851:web:0d724dac43a21adc840826",
};

let firebaseApp: FirebaseApp | null = null;
let db: Database | null = null;

// Khởi tạo Firebase client (gọi một lần trong background script)
export function initFirebaseClient(): { app: FirebaseApp; db: Database } {
  if (firebaseApp && db) return { app: firebaseApp, db };
  firebaseApp = initializeApp(firebaseConfig);
  db = getDatabase(firebaseApp);
  console.log("[Firebase] initialized (client)");
  return { app: firebaseApp, db };
}

export function getDb(): Database {
  if (!db) initFirebaseClient();
  return db!;
}

/**
 * Ghi toàn bộ node autoPosts (overwrite) - dùng khi sync sheet -> RTDB
 * updates: object with keys = rowId, values = { rowId, content, time, mediaUrls, status }
 */
export async function setAutoPostsNode(updates: AutoPostsUpdates): Promise<void> {
  console.log("[Firebase] Writing to autoPosts:", updates);
  const database = getDb();
  await set(ref(database, "autoPosts"), updates);
  console.log("[Firebase] ✅ Write complete");
}

/**
 * Set status for specific post row
 */
export async function setAutoPostStatus(rowId: string, status: AutoPost['status']): Promise<void> {
  if (!rowId) return;
  const database = getDb();
  await set(ref(database, `autoPosts/${rowId}/status`), status);
}

export async function saveCache(data: AutoPostsUpdates): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ autoPostsCache: data }, () => resolve());
  });
}

/**
 * Start listening for triggers/child_added.
 * If cb provided, call cb(triggerObject). Otherwise log.
 * Trigger object expected shape: { rowId, content, mediaUrls, createdAt }
 */
export function startTriggerListener(cb?: (trigger: TriggerData) => Promise<void> | void): void {
  const database = getDb();
  const triggersRef = ref(database, "triggers");
  onChildAdded(triggersRef, (snap: DataSnapshot) => {
    const data = snap.val() as TriggerData;
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
export async function removeTrigger(rowId: string): Promise<void> {
  const database = getDb();
  try {
    await remove(ref(database, `triggers/${rowId}`));
  } catch (e) {
    console.error("[Firebase] removeTrigger failed:", e);
  }
}

/**
 * Utility: read autoPosts once (useful for debugging)
 */
export async function readAutoPostsOnce(): Promise<AutoPostsUpdates | null> {
  const database = getDb();
  const rootRef = ref(database, "/");
  const snapshot = await get(child(rootRef, "autoPosts"));
  return snapshot.exists() ? (snapshot.val() as AutoPostsUpdates) : null;
}

const MARK_POSTED_URL = "https://asia-southeast1-autopostermmo.cloudfunctions.net/markPosted";

export async function tickAfterPost(rowId: string): Promise<boolean> {
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
      
      const result = await response.json() as MarkPostedResponse;
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
