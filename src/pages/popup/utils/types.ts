export type Post = {
  content: string;
  time?: string;
  mediaUrls?: string[]; // Thêm field cho media URLs
  status?: string; // Add status field for post state (pending, posted, etc.)
};

export type ScheduleItem = { 
  time: string; 
  content: string; 
  mediaUrls?: string[]; // Thêm media support cho schedule
};

export interface AlarmResponse {
  alarms: string[];
  message?: string;
}

export interface SyncResponse {
  success: boolean;
  message?: string;
  jobCount?: number;
}

export interface LogEntry {
  time: string;
  rowId: string;
  status: string;
};

export interface LogEntrySchedule {
  time: string;
  rowId?: string;
  type: string;
  msg: string;
}
