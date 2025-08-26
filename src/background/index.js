import { fetchMediaFromUrl } from "./media.js";
import { openFacebookAndPost } from "./fb.js";
import {
  getSchedule,
  setSchedule,
  createDailyAlarm,
  clearAllAutoPostAlarms,
  listAutoPostAlarms,
} from "./schedule.js";
import { initializeFirebaseSync,startTriggerListener } from "../firebase/firebase.js";
import { parseHHMM } from "./time.js";

// ======= FIXED MESSAGE LISTENER - NO DUPLICATES =======

startTriggerListener();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log("[Background] Received message:", message.type);

  (async () => {
    try {
      // ===== FETCH_MEDIA =====
      if (msg?.type === "NOTIFY_POST_RESULT") {
    console.log("[Background] NOTIFY_POST_RESULT:", msg);
    // store small history for UI or popup
    chrome.storage.local.get({ postHistory: [] }, (res) => {
      const hist = res.postHistory || [];
      hist.unshift({
        rowId: msg.rowId,
        success: !!msg.success,
        content: (msg.content || "").substring(0, 200),
        time: new Date().toISOString(),
      });
      const slice = hist.slice(0, 50);
      chrome.storage.local.set({ postHistory: slice });
    });
  }
      if (message.type === "FETCH_MEDIA") {
        const result = await fetchMediaFromUrl(message.url);
        sendResponse(result);
        return;
      }

      // ===== DOWNLOAD_MEDIA =====
      if (
        message.type === "DOWNLOAD_MEDIA" &&
        typeof message.url === "string"
      ) {
        const url = message.url;

        try {
          const res = await fetch(url);
          if (!res.ok) {
            throw new Error(`Fetch failed with status ${res.status}`);
          }

          const contentType =
            res.headers.get("content-type") || "application/octet-stream";
          const buffer = await res.arrayBuffer();
          const u8 = new Uint8Array(buffer);

          // convert sang base64 theo chunk để tránh stack overflow
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

      // ===== START_POST =====
      if (message.type === "START_POST") {
        openFacebookAndPost(message.posts);
        sendResponse({ message: "🚀 Đang mở Facebook cá nhân để đăng bài..." });
        return;
      }

      // ===== SET_SCHEDULE =====
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

      // ===== ADD_SCHEDULE_ITEM =====
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

      // ===== CLEAR_SCHEDULE =====
      if (message.type === "CLEAR_SCHEDULE") {
        await setSchedule([]);
        await clearAllAutoPostAlarms();
        sendResponse({ message: "🗹 Đã xóa toàn bộ lịch & alarms." });
        return;
      }

      // ===== LIST_ALARMS =====
      if (message.type === "LIST_ALARMS") {
        const list = await listAutoPostAlarms();
        sendResponse({ alarms: list });
        return;
      }
      // ✅ ===== POST_DONE =====
      if (message.type === "POST_DONE" && message.rowId) {
        await tickAfterPost(message.rowId);
        sendResponse({
          ok: true,
          message: `✅ Updated status for ${message.rowId}`,
        });
        return;
      }

      // ===== UNKNOWN =====
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

  // return true để giữ sendResponse async
  return true;
});

// ======= Bắt sự kiện tới giờ =======
/* Khi báo thức nổ, lấy item tương ứng HH:mm, gọi openFacebookAndPost([{content, mediaUrls}]) */
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
