console.log("✅ Background script running...");

// --- Helper functions ---------------------Media helpers-----
// convert ArrayBuffer to Base64
function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

// suy đoán mime và đảm bảo đuôi file hợp lệ.
function guessMimeFromExt(urlPath) {
  const lower = urlPath.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".avi")) return "video/avi";
  return "application/octet-stream";
}

function ensureExtByMime(name, mime) {
  const map = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/avi": ".avi",
  };
  const wantedExt = map[(mime || "").toLowerCase()];
  if (!wantedExt) return name;
  const lower = name.toLowerCase();
  const hasKnownExt = Object.values(map).some((ext) => lower.endsWith(ext));
  return hasKnownExt ? name : name + wantedExt;
}

//fetch cross-origin (thêm UA, Accept, Referer tùy host), timeout 45s, trả {ok, name, mime, bufferBase64, size} để content script tạo File upload.
// Fixed media fetch function
async function fetchMediaFromUrl(url) {
  console.log("[Background] Starting fetchMediaFromUrl:", url);
  try {
    let cleanUrl = (url || "").trim();
    if (!cleanUrl) throw new Error("Invalid URL");

    if (
      (cleanUrl.startsWith('"') && cleanUrl.endsWith('"')) ||
      (cleanUrl.startsWith("'") && cleanUrl.endsWith("'"))
    )
      cleanUrl = cleanUrl.slice(1, -1);

    const urlObj = new URL(cleanUrl);
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "image/webp,image/apng,image/*,*/*;q=0.8,video/*",
      "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    };

    const hostname = urlObj.hostname.toLowerCase();
    if (hostname.includes("github")) headers["Referer"] = "https://github.com/";
    else if (hostname.includes("imgur"))
      headers["Referer"] = "https://imgur.com/";
    else if (hostname.includes("dropbox"))
      headers["Referer"] = "https://www.dropbox.com/";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    const response = await fetch(cleanUrl, {
      method: "GET",
      headers,
      signal: controller.signal,
      // In MV3 + host_permissions, the extension context can read cross-origin.
      // Keep mode default; forcing "no-cors" would make it opaque (unreadable).
      redirect: "follow",
      credentials: "omit",
    });

    clearTimeout(timeoutId);
    if (!response.ok)
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength === 0) throw new Error("Empty response");

    const contentType =
      response.headers.get("content-type") || guessMimeFromExt(cleanUrl);

    let filename = "media";
    try {
      const last = urlObj.pathname.split("/").pop();
      if (last) filename = last.split("?")[0];
    } catch {}
    filename = ensureExtByMime(filename, contentType);

    const result = {
      ok: true,
      name: filename,
      mime: contentType,
      bufferBase64: arrayBufferToBase64(arrayBuffer),
      size: arrayBuffer.byteLength,
      originalUrl: url,
    };
    console.log("[Background] Fetch successful:", {
      name: result.name,
      mime: result.mime,
      size: result.size,
    });
    return result;
  } catch (error) {
    console.error("[Background] fetchMediaFromUrl error:", error);
    const msg =
      error && error.name === "AbortError"
        ? "Request timeout - file too large or server too slow"
        : error?.message || String(error);
    return { ok: false, name: "", mime: "", error: msg, originalUrl: url };
  }
}

// ----------------Scheduling--------------------
const ALARM_PREFIX = "AUTOPOST|";

// ======= Utils thời gian =======
// parse giờ, tạo alarms ngày kế tiếp, lặp hàng ngày
function parseHHMM(hhmm) {
  const m = /^([0-2]\d):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  return { h: Number(m[1]), m: Number(m[2]) };
}

function nextTriggerFromHHMM(hhmm) {
  const pm = parseHHMM(hhmm);
  if (!pm) return null;
  const now = new Date();
  const trigger = new Date();
  trigger.setHours(pm.h, pm.m, 0, 0);
  if (trigger.getTime() <= now.getTime())
    trigger.setDate(trigger.getDate() + 1);
  return trigger.getTime();
}

function alarmNameFor(hhmm) {
  return `${ALARM_PREFIX}${hhmm}`;
}

// ======= Tạo / xóa alarms =======
async function createDailyAlarm(hhmm) {
  const when = nextTriggerFromHHMM(hhmm);
  if (!when) throw new Error("Giờ không hợp lệ: " + hhmm);
  const name = alarmNameFor(hhmm);
  await chrome.alarms.create(name, { when, periodInMinutes: 1440 });
  console.log("⏰ Created alarm:", name, "at", new Date(when).toLocaleString());
}

async function clearAllAutoPostAlarms() {
  const all = await chrome.alarms.getAll();
  const targets = all.filter((a) => a.name.startsWith(ALARM_PREFIX));
  await Promise.all(targets.map((a) => chrome.alarms.clear(a.name)));
  console.log("🗹 Cleared", targets.length, "alarms.");
}

async function listAutoPostAlarms() {
  const all = await chrome.alarms.getAll();
  return all
    .filter((a) => a.name.startsWith(ALARM_PREFIX))
    .map((a) => `${a.name} -> ${new Date(a.scheduledTime).toLocaleString()}`);
}

// ======= Đăng Facebook ======= Facebook flow
// mở tab me,chờ onUpdated:complete, set postsToPost, inject contentScript.js, gửi START_POST.
function openFacebookAndPost(posts) {
  console.log("[Background] Opening Facebook to post:", posts.length, "posts");
  chrome.tabs.create({ url: "https://www.facebook.com/me" }, (tab) => {
    function listener(tabId, changeInfo) {
      if (tabId === tab.id && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        console.log("[Background] Facebook loaded, injecting script...");
        chrome.storage.local.set({ postsToPost: posts }, () => {
          chrome.scripting.executeScript(
            { target: { tabId }, files: ["contentScript.js"] },
            () => {
              if (chrome.runtime.lastError) {
                console.error(
                  "⚠ Inject script error:",
                  chrome.runtime.lastError.message
                );
                return;
              }
              console.log(
                "[Background] Script injected, sending START_POST message"
              );
              chrome.tabs.sendMessage(
                tabId,
                { type: "START_POST" },
                (response) => {
                  if (chrome.runtime.lastError) {
                    console.error(
                      "⚠ Send message error:",
                      chrome.runtime.lastError.message
                    );
                  } else {
                    console.log("📩 Response from content script:", response);
                  }
                }
              );
            }
          );
        });
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ======= Storage helpers =======
async function getSchedule() {
  const data = await chrome.storage.local.get("schedule");
  return data.schedule || [];
}
async function setSchedule(schedule) {
  await chrome.storage.local.set({ schedule });
}

// ======= FIXED MESSAGE LISTENER - NO DUPLICATES =======
// Message router :Nhận:
/*
FETCH_MEDIA → fetchMediaFromUrl

START_POST → openFacebookAndPost

SET_SCHEDULE / ADD_SCHEDULE_ITEM / CLEAR_SCHEDULE / LIST_ALARMS

Mặc định trả “Unknown message type…”.*/
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log("[Background] Received message:", message.type);
  (async () => {
    try {
      if (message.type === "FETCH_MEDIA") {
        const result = await fetchMediaFromUrl(message.url);
        sendResponse(result);
        return;
      }
      if (
        message.type === "DOWNLOAD_MEDIA" &&
        typeof message.url === "string"
      ) {
        const url = message.url;

        fetch(url)
          .then(async (res) => {
            if (!res.ok) {
              throw new Error(`Fetch failed with status ${res.status}`);
            }

            // đọc content-type để gán cho blob
            const contentType =
              res.headers.get("content-type") || "application/octet-stream";

            // đọc binary data
            const buffer = await res.arrayBuffer();
            const u8 = new Uint8Array(buffer);

            // convert sang base64
            let binary = "";
            const chunkSize = 0x8000; // tránh callstack overflow khi convert chuỗi lớn
            for (let i = 0; i < u8.length; i += chunkSize) {
              const chunk = u8.subarray(i, i + chunkSize);
              binary += String.fromCharCode.apply(null, Array.from(chunk));
            }
            const b64 = btoa(binary);

            // Trả kết quả
            sendResponse({
              success: true,
              data: `data:${contentType};base64,${b64}`,
              type: contentType,
            });
          })
          .catch((err) => {
            console.error("[AutoPoster] DOWNLOAD_MEDIA fetch error:", err);
            sendResponse({ success: false, error: String(err) });
          });

        // trả về true để giữ sendResponse async
        return true;
      }
      if (message.type === "START_POST") {
        openFacebookAndPost(message.posts);
        sendResponse({ message: "🚀 Đang mở Facebook cá nhân để đăng bài..." });
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
        const list = await listAutoPostAlarms();
        sendResponse({ alarms: list });
        return;
      }
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
