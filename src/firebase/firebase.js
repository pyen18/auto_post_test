// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue } from "firebase/database";
import { onChildAdded, remove } from "firebase/database";
import { postContentToFacebook } from "../content/post.ts";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDc4m_kk6RMWKrOtsMErgWjueMdgftyypg",
  authDomain: "autopostermmo.firebaseapp.com",
  projectId: "autopostermmo",
  storageBucket: "autopostermmo.firebasestorage.app",
  messagingSenderId: "916563696851",
  appId: "1:916563696851:web:0d724dac43a21adc840826",
};

// Initialize Firebase
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

async function tickAfterPost(rowId) {
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

