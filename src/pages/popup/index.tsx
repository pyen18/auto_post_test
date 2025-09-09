import { useEffect, useState } from "react";
import { usePosts } from "./hooks/usePosts";
import "./popup.css";
import {
  startPosting,
  setSchedule,
  clearSchedule,
  listAlarms,
  syncFromSheet, // ✅ sẽ gửi message cho background để gọi fetchAndSyncSheetToRTDB()
} from "./service/ChromeApi";
import type { ScheduleItem } from "./utils/types";
import PostList from "./components/PostList";
import MediaStats from "./components/MediaStats";
import AlarmList from "./components/AlarmList";
import CsvFormatHint from "./components/CsvFormatHint"; 
import ScheduledPostForm from "./components/ScheduledPostForm";
import StatusLog from "./components/StatusLog";

export default function Popup() {
  const { posts, loading, message, setMessage, fetchPosts } = usePosts();
  const [alarms, setAlarms] = useState<string[]>([]);
  const [sheetUrl, setSheetUrl] = useState("");

  useEffect(() => refreshAlarmsList(), []);

  function startPostingNow() {
    const pendingPosts = posts.filter((p) => p.status === "pending");
    if (pendingPosts.length === 0)
      return setMessage("Không có bài viết nào ở trạng thái pending.");
    startPosting(pendingPosts, (res) =>
      setMessage(res?.message || "Đã gửi yêu cầu đăng bài cho pending posts.")
    );
  }

  function scheduleFromSheet() {
    const items: ScheduleItem[] = posts
      .filter(
        (p) =>
          p.status === "pending" && p.time && /^[0-2]\d:[0-5]\d$/.test(p.time)
      )
      .map((p) => ({
        time: p.time!,
        content: p.content,
        mediaUrls: p.mediaUrls || [],
      }));

    if (items.length === 0)
      return setMessage("Không có bài hợp lệ với status=pending và time HH:MM.");

    setSchedule(items, (res) => {
      setMessage(res?.message || "Đã đặt lịch từ sheet.");
      refreshAlarmsList();
    });
  }

  function refreshAlarmsList() {
    listAlarms((res) => setAlarms(res?.alarms || []));
  }

  function handleSyncFromSheet() {
    setMessage("Đang đồng bộ từ Google Sheet...");
    syncFromSheet((res) => {
      setMessage(res?.message || "Đã đồng bộ từ Google Sheet.");
      fetchPosts();
    });
  }
function testPostNow() {
  chrome.runtime.sendMessage(
    { 
      type: "START_POST",
      posts: [
        {
          rowId: "1",
          content: "🚀 Đây là bài test auto post với rowId=1",
          mediaUrls: [],
        },
      ],
    },
    (res) => {
      console.log("[Popup] TestPostNow response:", res);
      setMessage(res?.message || "Đã gửi bài test tới background.");
    }
  );
}

function debugDialogs() {
  chrome.runtime.sendMessage(
    { type: "DEBUG_DIALOGS" },
    (res) => {
      console.log("[Popup] DEBUG_DIALOGS response:", res);
      if (res.error) {
        setMessage(`Debug error: ${res.error}`);
      } else {
        setMessage(`Debug: Found ${res.dialogs?.length || 0} dialogs, ${res.composers?.length || 0} composers`);
      }
    }
  );
}


  return (
    <div className="w-96 p-4 font-sans bg-gray-50">
      <h2 className="text-lg font-bold mb-3">Auto FB Poster</h2>

      <div className="flex gap-2 mb-3">
        <button
          onClick={fetchPosts}
          disabled={loading}
          className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-blue-300 text-sm"
        >
          {loading ? "Đang tải..." : "Tải từ Firebase DB"}
        </button>
        <button
          onClick={handleSyncFromSheet}
          className="px-3 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 text-sm"
        >
          Re-sync Google Sheet
        </button>
         <button
    onClick={testPostNow}
    className="px-3 py-2 bg-red-500 text-white rounded hover:bg-red-600 text-sm"
  >
    Test Post Now
  </button>
         <button
    onClick={debugDialogs}
    className="px-3 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600 text-sm"
  >
    Debug Dialogs
  </button>
      </div>

      <CsvFormatHint />
      <PostList posts={posts} />

      <div className="flex gap-2 mt-3">
        <button
          onClick={startPostingNow}
          className="flex-1 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
        >
          Đăng ngay
        </button>
        <button
          onClick={scheduleFromSheet}
          className="flex-1 px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
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
          className="flex-1 px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
        >
          Xóa lịch
        </button>
      </div>

      {message && (
        <p className="mt-3 text-sm text-gray-700 bg-gray-100 p-2 rounded">
          {message}
        </p>
      )}

      <div className="mt-4 border-t pt-3">
        <ScheduledPostForm 
          sheetUrl={sheetUrl}
          onSheetUrlChange={setSheetUrl}
          onFetch={async () => {
            await handleSyncFromSheet();
          }}
          loading={loading}
        />
      </div>

      <AlarmList alarms={alarms} />
      <MediaStats posts={posts} />
      <StatusLog />
    </div>
  );
}
