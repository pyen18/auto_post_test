// Chrome Extension Types
export type ChromeTab = chrome.tabs.Tab;

export type ChromeAlarm = chrome.alarms.Alarm;

// Post Job Types
export interface PostJob {
  rowId: string;
  content: string;
  mediaUrls: string[];
  time: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
}

export interface AutoPost extends PostJob {
  id?: string;
  timestamp?: number;
}

// Firebase Types
export interface TriggerData {
  rowId: string;
  content: string;
  mediaUrls?: string[];
  timestamp?: number;
}

export interface FirebaseAutoPost {
  [key: string]: AutoPost;
}

// Content Script Communication Types
export interface PostResponse {
  success: boolean;
  message?: string;
  error?: string;
  successCount?: number;
  failedCount?: number;
}

export interface ContentScriptMessage {
  type: 'START_POST' | 'PING' | 'SYNC_DONE' | 'FETCH_MEDIA';
  posts?: PostJob[];
  payload?: Record<string, unknown>;
  timestamp?: number;
  url?: string;
}

export interface MediaFetchResponse {
  ok: boolean;
  name: string;
  mime: string;
  bufferBase64?: string;
  error?: string;
  originalUrl?: string;
}

export interface ContentScriptResponse {
  ready?: boolean;
  ok?: boolean;
  success?: boolean;
  message?: string;
  error?: string;
  timestamp?: number;
  url?: string;
}

// Cache and Storage Types
export interface CacheData {
  [rowId: string]: AutoPost;
}

export interface StorageData {
  autoPostsCache?: CacheData;
  postsToPost?: PostJob[];
  schedule?: PostJob[];
}

// Processing Lock Types
export interface ProcessingLock {
  _posts: Set<string>;
  acquire: (rowId: string) => Promise<boolean>;
  release: (rowId: string) => void;
}

// Utility Types
export type PostStatus = PostJob['status'];

export interface TimeComponents {
  hh: number;
  mm: number;
}

// API Response Types
export interface FirebaseResponse {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

// Sync Types
export interface SyncResult {
  success: boolean;
  updatedCount: number;
  errors?: string[];
}

// Alarm Types
export interface AlarmInfo {
  name: string;
  scheduledTime: number;
  periodInMinutes?: number;
}
