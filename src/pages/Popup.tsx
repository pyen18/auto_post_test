import { useEffect, useState } from "react";
import ScheduledPostForm from "./popup/components/ScheduledPostForm";

const GOOGLE_SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRgvUaPLvI5hb35mqbVASImB5dHZOUtiVVNCqU2L0pxFDRDG1E4YPbLhk_uCCp9yWvWwWJufhjGqnXg/pub?gid=0&single=true&output=csv";

type Post = {
  content: string;
  time?: string;
  mediaUrls?: string[]; // Thêm field cho media URLs
};

type ScheduleItem = { 
  time: string; 
  content: string; 
  mediaUrls?: string[]; // Thêm media support cho schedule
};

export default function Popup() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [alarms, setAlarms] = useState<string[]>([]);

  useEffect(() => {
    refreshAlarmsList();
  }, []);

  function parseCsvLine(line: string) {
    // Tách CSV: content,time,mediaUrls (mediaUrls có thể là nhiều URL cách nhau bởi semicolon)
    const parts = line.split(',').map(part => part.trim());
    
    if (parts.length < 1) {
      return { content: '', time: undefined, mediaUrls: [] };
    }

    const content = parts[0] || '';
    const time = parts[1] || undefined;
    const mediaUrlsRaw = parts[2] || '';
    
    // Parse media URLs - split by semicolon and filter valid URLs
    const mediaUrls = mediaUrlsRaw
      .split(';')
      .map(url => url.trim())
      .filter(url => {
        try {
          new URL(url);
          return url.match(/\.(jpg|jpeg|png|gif|mp4|avi|mov|webm)$/i);
        } catch {
          return false;
        }
      });

    return { content, time, mediaUrls };
  }

  async function fetchPosts() {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch(GOOGLE_SHEET_CSV_URL);
      if (!res.ok) throw new Error("Không thể tải dữ liệu sheet");
      const csvText = await res.text();

      const lines = csvText.trim().split("\n");
      // Bỏ header
      const rows = lines.slice(1, 3).map(parseCsvLine);
      const postsData: Post[] = rows.map((r) => ({
        content: r.content || "",
        time: r.time,
        mediaUrls: r.mediaUrls || [],
      }));

      setPosts(postsData);
      setMessage(`Đã lấy ${postsData.length} bài viết`);
    } catch (err) {
      setMessage("Lỗi khi lấy dữ liệu: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function startPostingNow() {
    if (posts.length === 0) {
      setMessage("Chưa có bài viết để đăng.");
      return;
    }
    const toSend = posts.map((p) => ({ 
      content: p.content,
      mediaUrls: p.mediaUrls || []
    }));
    chrome.runtime.sendMessage({ type: "START_POST", posts: toSend }, (res) => {
      setMessage(res?.message || "Đã gửi yêu cầu đăng bài.");
    });
  }

  function scheduleFromSheet() {
    if (posts.length === 0) {
      setMessage("Chưa có dữ liệu để đặt lịch (hãy bấm 'Lấy bài từ Google Sheet').");
      return;
    }
    const items: ScheduleItem[] = posts
      .filter((p) => p.time && /^[0-2]\d:[0-5]\d$/.test(p.time))
      .map((p) => ({ 
        time: p.time!, 
        content: p.content,
        mediaUrls: p.mediaUrls || []
      }));

    if (items.length === 0) {
      setMessage("Không có dòng hợp lệ với time HH:MM.");
      return;
    }

    chrome.runtime.sendMessage({ type: "SET_SCHEDULE", schedule: items }, (res) => {
      setMessage(res?.message || "Đã đặt lịch từ sheet.");
      refreshAlarmsList();
    });
  }

  function clearSchedule() {
    chrome.runtime.sendMessage({ type: "CLEAR_SCHEDULE" }, (res) => {
      setMessage(res?.message || "Đã xóa lịch.");
      refreshAlarmsList();
    });
  }

  function refreshAlarmsList() {
    chrome.runtime.sendMessage({ type: "LIST_ALARMS" }, (res) => {
      setAlarms(res?.alarms || []);
    });
  }

  // Validate URL helper
  function isValidMediaUrl(url: string): boolean {
    try {
      new URL(url);
      return url.match(/\.(jpg|jpeg|png|gif|mp4|avi|mov|webm)$/i) !== null;
    } catch {
      return false;
    }
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

      {/* Hướng dẫn format CSV */}
      <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
        <strong>Format CSV:</strong> content,time,mediaUrls<br/>
        <strong>MediaUrls:</strong> Nhiều URL cách nhau bởi dấu ;<br/>
        <strong>Ví dụ:</strong> "Nội dung bài viết,09:30,https://example.com/image1.jpg;https://example.com/video.mp4"
      </div>

      <div className="my-3 space-y-2">
        {posts.map((post, i) => (
          <div
            key={i}
            className="p-2 bg-white border border-gray-300 rounded text-sm"
          >
            <div className="font-semibold">Bài #{i + 1}</div>
            <div className="whitespace-pre-wrap break-words">{post.content}</div>
            {post.time && (
              <div className="text-xs text-gray-500 mt-1">⏰ {post.time}</div>
            )}
            {post.mediaUrls && post.mediaUrls.length > 0 && (
              <div className="mt-2">
                <div className="text-xs font-semibold text-purple-600 mb-1">
                  📎 Media ({post.mediaUrls.length}):
                </div>
                <div className="space-y-1">
                  {post.mediaUrls.map((url, idx) => (
                    <div key={idx} className="flex items-center text-xs">
                      <span className={`inline-block w-2 h-2 rounded-full mr-2 ${
                        isValidMediaUrl(url) ? 'bg-green-400' : 'bg-red-400'
                      }`}></span>
                      <span className="truncate flex-1" title={url}>
                        {url}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={startPostingNow}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
        >
          Đăng ngay (2 bài)
        </button>
        <button
          onClick={scheduleFromSheet}
          className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
        >
          Đặt lịch từ Sheet
        </button>
        <button
          onClick={clearSchedule}
          className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
        >
          Xóa lịch
        </button>
      </div>  

      {message && <p className="mt-3 text-sm text-gray-700">{message}</p>}

      {/* Form thêm lịch thủ công */}
      <div className="mt-4 border-t pt-3">
        <ScheduledPostForm posts={posts} onChanged={refreshAlarmsList} />
      </div>

      {/* Debug alarms */}
      <div className="mt-3">
        <div className="text-sm font-semibold mb-1">Alarms đã tạo:</div>
        <ul className="text-xs list-disc pl-5 space-y-1">
          {alarms.length === 0 && <li>(trống)</li>}
          {alarms.map((a, idx) => (
            <li key={idx}>{a}</li>
          ))}
        </ul>
      </div>

      {/* Media Statistics */}
      {posts.length > 0 && (
        <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded">
          <div className="text-sm font-semibold text-blue-700 mb-1">📊 Thống kê Media:</div>
          <div className="text-xs space-y-1">
            <div>📝 Tổng bài viết: {posts.length}</div>
            <div>🖼️ Bài có media: {posts.filter(p => p.mediaUrls && p.mediaUrls.length > 0).length}</div>
            <div>📎 Tổng media files: {posts.reduce((sum, p) => sum + (p.mediaUrls?.length || 0), 0)}</div>
          </div>
        </div>
      )}
    </div>
  );
}