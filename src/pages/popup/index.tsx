import { useEffect, useState } from "react";
import { usePosts } from "./hooks/usePosts";
import {
  startPosting,
  setSchedule,
  clearSchedule,
  listAlarms,
} from "./service/ChromeApi";
import type { ScheduleItem } from "./utils/types";
import PostList from "./components/PostList";
import MediaStats from "./components/MediaStats";
import AlarmList from "./components/AlarmList";
import CsvFormatHint from "./components/CsvFormatHint";
import ScheduledPostForm from "./components/ScheduledPostForm";

export default function Popup() {
  const { posts, loading, message, setMessage, fetchPosts } = usePosts();
  const [alarms, setAlarms] = useState<string[]>([]);

  useEffect(() => refreshAlarmsList(), []);

  function startPostingNow() {
    if (posts.length === 0) return setMessage("Chưa có bài viết để đăng.");
    startPosting(posts, (res) =>
      setMessage(res?.message || "Đã gửi yêu cầu đăng bài.")
    );
  }

  function scheduleFromSheet() {
    const items: ScheduleItem[] = posts
      .filter((p) => p.time && /^[0-2]\d:[0-5]\d$/.test(p.time))
      .map((p) => ({
        time: p.time!,
        content: p.content,
        mediaUrls: p.mediaUrls || [],
      }));

    if (items.length === 0)
      return setMessage("Không có dòng hợp lệ với time HH:MM.");

    setSchedule(items, (res) => {
      setMessage(res?.message || "Đã đặt lịch từ sheet.");
      refreshAlarmsList();
    });
  }

  function refreshAlarmsList() {
    listAlarms((res) => setAlarms(res?.alarms || []));
  }

  return (
    <div className="w-96 p-4 font-sans bg-gray-50">
      <h2 className="text-lg font-bold mb-3">Auto FB Poster</h2>

      <button
        onClick={fetchPosts}
        disabled={loading}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-blue-300"
      >
        {loading ? "Đang tải..." : "Lấy bài từ Google Sheet"}
      </button>

      <CsvFormatHint />
      <PostList posts={posts} />

      <div className="flex gap-2">
        <button
          onClick={startPostingNow}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
        >
          Đăng ngay
        </button>
        <button
          onClick={scheduleFromSheet}
          className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
        >
          Đặt lịch
        </button>
        <button
          onClick={() =>
            clearSchedule((res) => {
              setMessage(res?.message || "Đã xóa lịch.");
              refreshAlarmsList();
            })
          }
          className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
        >
          Xóa lịch
        </button>
      </div>

      {message && <p className="mt-3 text-sm text-gray-700">{message}</p>}

      <div className="mt-4 border-t pt-3">
        <ScheduledPostForm posts={posts} onChanged={refreshAlarmsList} />
      </div>

      <AlarmList alarms={alarms} />
      <MediaStats posts={posts} />
    </div>
  );
}
