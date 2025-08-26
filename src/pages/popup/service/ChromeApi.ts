import type { Post, ScheduleItem, AlarmResponse } from "../utils/types";

type RuntimeCallback = (response: AlarmResponse | undefined) => void;

export function startPosting(posts: Post[], cb?: RuntimeCallback): void {
  chrome.runtime.sendMessage({ type: "START_POST", posts }, (res) => {
    if (cb) cb(res as AlarmResponse);
  });
}

export function setSchedule(schedule: ScheduleItem[], cb?: RuntimeCallback): void {
  chrome.runtime.sendMessage({ type: "SET_SCHEDULE", schedule }, (res) => {
    if (cb) cb(res as AlarmResponse);
  });
}

export function clearSchedule(cb?: RuntimeCallback): void {
  chrome.runtime.sendMessage({ type: "CLEAR_SCHEDULE" }, (res) => {
    if (cb) cb(res as AlarmResponse);
  });
}

export function listAlarms(cb?: RuntimeCallback): void {
  chrome.runtime.sendMessage({ type: "LIST_ALARMS" }, (res) => {
    if (cb) cb(res as AlarmResponse);
  });
}
