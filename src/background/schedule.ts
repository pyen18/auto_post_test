// Types
interface TimeComponents {
  h: number;
  m: number;
}

interface PostJob {
  rowId: string;
  content: string;
  time: string;
  mediaUrls: string[];
  status: 'pending' | 'processing' | 'done' | 'failed';
}

const STORAGE_KEY = "schedule";
// ----------------Scheduling--------------------
const ALARM_PREFIX = "AUTOPOST|";

// ======= Utils thời gian =======
// parse giờ, tạo alarms ngày kế tiếp, lặp hàng ngày
export function parseHHMM(hhmm: string): TimeComponents | null {
  const m = /^([0-2]\d):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  return { h: Number(m[1]), m: Number(m[2]) };
}

export function nextTriggerFromHHMM(hhmm: string): number | null {
  const pm = parseHHMM(hhmm);
  if (!pm) return null;
  const now = new Date();
  const trigger = new Date();
  trigger.setHours(pm.h, pm.m, 0, 0);
  if (trigger.getTime() <= now.getTime())
    trigger.setDate(trigger.getDate() + 1);
  return trigger.getTime();
}

export function alarmNameFor(hhmm: string): string {
  return `${ALARM_PREFIX}${hhmm}`;
}

// ======= Tạo / xóa alarms =======
export async function createDailyAlarm(hhmm: string): Promise<void> {
  const when = nextTriggerFromHHMM(hhmm);
  if (!when) throw new Error("Giờ không hợp lệ: " + hhmm);
  const name = alarmNameFor(hhmm);
  await chrome.alarms.create(name, { when, periodInMinutes: 1440 });
  console.log("⏰ Created alarm:", name, "at", new Date(when).toLocaleString());
}

export async function clearAllAutoPostAlarms(): Promise<void> {
  const all = await chrome.alarms.getAll();
  const targets = all.filter((a) => a.name.startsWith(ALARM_PREFIX));
  await Promise.all(targets.map((a) => chrome.alarms.clear(a.name)));
  console.log("🗹 Cleared", targets.length, "alarms.");
}

export async function listAutoPostAlarms(): Promise<string[]> {
  const all = await chrome.alarms.getAll();
  return all
    .filter((a) => a.name.startsWith(ALARM_PREFIX))
    .map((a) => `${a.name} -> ${new Date(a.scheduledTime).toLocaleString()}`);
}

// ======= Storage helpers =======
export function getSchedule(): Promise<PostJob[]> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(STORAGE_KEY, (res) => {
        resolve(res[STORAGE_KEY] || []);
      });
    } catch (err) {
      console.error("[getSchedule] Error:", err);
      resolve([]);
    }
  });
}

export function setSchedule(jobs: PostJob[]): Promise<boolean> {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: jobs }, () => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve(true);
      });
    } catch (err) {
      reject(err);
    }
  });
}

// ======= Post Status Management =======
export async function setAutoPostStatus(rowId: string, status: PostJob['status']): Promise<void> {
  try {
    const jobs = await getSchedule();
    const updatedJobs = jobs.map(job => 
      job.rowId === rowId ? { ...job, status } : job
    );
    await setSchedule(updatedJobs);
    console.log(`[setAutoPostStatus] Updated ${rowId} to ${status}`);
  } catch (error) {
    console.error(`[setAutoPostStatus] Error updating ${rowId}:`, error);
    throw error;
  }
}

export async function tickAfterPost(rowId: string): Promise<void> {
  try {
    // This function can be used for any post-processing tasks
    // For now, it just logs the completion
    console.log(`[tickAfterPost] Post-processing completed for ${rowId}`);
    
    // You can add additional logic here like:
    // - Updating analytics
    // - Sending notifications
    // - Cleaning up temporary data
    
  } catch (error) {
    console.error(`[tickAfterPost] Error in post-processing for ${rowId}:`, error);
    throw error;
  }
}
