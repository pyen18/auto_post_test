export type Post = {
  content: string;
  time?: string;
  mediaUrls?: string[]; // Thêm field cho media URLs
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