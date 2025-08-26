const STORAGE_KEY = "schedule";
// ----------------Scheduling--------------------
const ALARM_PREFIX = "AUTOPOST|";

// ======= Utils thời gian =======
// parse giờ, tạo alarms ngày kế tiếp, lặp hàng ngày
export function parseHHMM(hhmm) {
  const m = /^([0-2]\d):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  return { h: Number(m[1]), m: Number(m[2]) };
}

export function nextTriggerFromHHMM(hhmm) {
  const pm = parseHHMM(hhmm);
  if (!pm) return null;
  const now = new Date();
  const trigger = new Date();
  trigger.setHours(pm.h, pm.m, 0, 0);
  if (trigger.getTime() <= now.getTime())
    trigger.setDate(trigger.getDate() + 1);
  return trigger.getTime();
}

export function alarmNameFor(hhmm) {
  return `${ALARM_PREFIX}${hhmm}`;
}

// ======= Tạo / xóa alarms =======
export async function createDailyAlarm(hhmm) {
  const when = nextTriggerFromHHMM(hhmm);
  if (!when) throw new Error("Giờ không hợp lệ: " + hhmm);
  const name = alarmNameFor(hhmm);
  await chrome.alarms.create(name, { when, periodInMinutes: 1440 });
  console.log("⏰ Created alarm:", name, "at", new Date(when).toLocaleString());
}

export async function clearAllAutoPostAlarms() {
  const all = await chrome.alarms.getAll();
  const targets = all.filter((a) => a.name.startsWith(ALARM_PREFIX));
  await Promise.all(targets.map((a) => chrome.alarms.clear(a.name)));
  console.log("🗹 Cleared", targets.length, "alarms.");
}

export async function listAutoPostAlarms() {
  const all = await chrome.alarms.getAll();
  return all
    .filter((a) => a.name.startsWith(ALARM_PREFIX))
    .map((a) => `${a.name} -> ${new Date(a.scheduledTime).toLocaleString()}`);
}

// ======= Storage helpers =======
export async function getSchedule() {
  const data = await chrome.storage.local.get("schedule");
  return data.schedule || [];
}
export async function setSchedule(schedule) {
  await chrome.storage.local.set({ schedule });
}
