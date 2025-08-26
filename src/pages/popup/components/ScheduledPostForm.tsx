import { useState } from "react";

type Post = {
  content: string;
  time?: string;
  mediaUrls?: string[];
};

type Props = {
  posts: Post[];
  onChanged: () => void;
};

export default function ScheduledPostForm({ posts, onChanged }: Props) {
  const [time, setTime] = useState("");
  const [content, setContent] = useState("");
  const [mediaUrls, setMediaUrls] = useState("");
  const [message, setMessage] = useState("");
  const [validatingUrls, setValidatingUrls] = useState(false);

  // Validate URL helper
  function isValidMediaUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      if (urlObj.protocol !== 'https:') return false;
      return url.match(/\.(jpg|jpeg|png|gif|mp4|avi|mov|webm|bmp|svg|webp)$/i) !== null;
    } catch {
      return false;
    }
  }

  // Parse và validate media URLs
  function parseMediaUrls(urlsText: string): string[] {
    if (!urlsText.trim()) return [];
    
    return urlsText
      .split(/[;\n,]/) // Hỗ trợ nhiều delimiter
      .map(url => url.trim())
      .filter(url => url.length > 0)
      .filter(isValidMediaUrl);
  }

  async function validateUrlsInRealtime(urlsText: string) {
    const urls = parseMediaUrls(urlsText);
    if (urls.length === 0) return;

    setValidatingUrls(true);
    try {
      // Validate từng URL bằng cách thử fetch HEAD request
      const validationPromises = urls.slice(0, 5).map(async (url) => { // Chỉ validate 5 URL đầu
        try {
          await fetch(url, { method: 'HEAD', mode: 'no-cors' });
          return { url, valid: true };
        } catch {
          return { url, valid: false };
        }
      });

      await Promise.all(validationPromises);
    } finally {
      setValidatingUrls(false);
    }
  }

  function addScheduleItem() {
    if (!time.match(/^[0-2]\d:[0-5]\d$/)) {
      setMessage("❌ Định dạng giờ không hợp lệ (HH:MM)");
      return;
    }

    if (!content.trim()) {
      setMessage("❌ Nội dung không được trống");
      return;
    }

    const parsedMediaUrls = parseMediaUrls(mediaUrls);
    
    const item = {
      time: time.trim(),
      content: content.trim(),
      mediaUrls: parsedMediaUrls
    };

    chrome.runtime.sendMessage({ type: "ADD_SCHEDULE_ITEM", item }, (res) => {
      if (res?.message) {
        setMessage(res.message);
        if (res.message.includes("✅")) {
          // Success - clear form
          setTime("");
          setContent("");
          setMediaUrls("");
          onChanged();
        }
      }
    });
  }

  function loadFromExistingPost(post: Post) {
    setTime(post.time || "");
    setContent(post.content);
    setMediaUrls((post.mediaUrls || []).join(';'));
    setMessage("📋 Đã load dữ liệu từ bài viết");
  }

  const parsedUrls = parseMediaUrls(mediaUrls);
  const hasInvalidUrls = mediaUrls.trim() && parsedUrls.length === 0;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">➕ Thêm lịch thủ công</h3>

      {/* Quick load from existing posts */}
      {posts.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-gray-600">📋 Load từ bài đã có:</div>
          <div className="flex gap-1 flex-wrap">
            {posts.map((post, idx) => (
              <button
                key={idx}
                onClick={() => loadFromExistingPost(post)}
                className="px-2 py-1 text-xs bg-gray-200 hover:bg-gray-300 rounded"
                title={`${post.content.slice(0, 50)}... | Media: ${post.mediaUrls?.length || 0}`}
              >
                #{idx + 1} {post.time && `⏰${post.time}`} 
                {post.mediaUrls && post.mediaUrls.length > 0 && ` 📎${post.mediaUrls.length}`}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
          placeholder="HH:MM"
        />

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Nội dung bài viết..."
          className="w-full px-2 py-1 border border-gray-300 rounded text-sm h-16 resize-none"
        />

        <div className="space-y-1">
          <textarea
            value={mediaUrls}
            onChange={(e) => {
              setMediaUrls(e.target.value);
              // Debounce validation
              setTimeout(() => validateUrlsInRealtime(e.target.value), 500);
            }}
            placeholder="Media URLs (cách nhau bởi ; hoặc xuống dòng)&#10;VD: https://example.com/image1.jpg;https://example.com/video.mp4"
            className={`w-full px-2 py-1 border rounded text-sm h-12 resize-none ${
              hasInvalidUrls ? 'border-red-300 bg-red-50' : 'border-gray-300'
            }`}
          />
          
          {/* Media URLs validation feedback */}
          {mediaUrls.trim() && (
            <div className="text-xs space-y-1">
              {validatingUrls && (
                <div className="text-blue-600">🔍 Đang kiểm tra URLs...</div>
              )}
              
              {parsedUrls.length > 0 && (
                <div className="text-green-600">
                  ✅ {parsedUrls.length} URL hợp lệ
                </div>
              )}
              
              {hasInvalidUrls && (
                <div className="text-red-600">
                  ❌ Không có URL hợp lệ nào. Chỉ hỗ trợ HTTPS và các định dạng: jpg, png, gif, mp4, webm, v.v.
                </div>
              )}

              {/* Preview URLs */}
              {parsedUrls.length > 0 && (
                <div className="max-h-20 overflow-y-auto bg-gray-50 p-1 rounded">
                  {parsedUrls.map((url, idx) => (
                    <div key={idx} className="flex items-center text-xs">
                      <span className="text-green-500 mr-1">✓</span>
                      <span className="truncate" title={url}>
                        {url.split('/').pop()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <button
          onClick={addScheduleItem}
          disabled={!time || !content.trim() || validatingUrls}
          className="w-full px-3 py-1 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:bg-orange-300 text-sm"
        >
          {validatingUrls ? "🔍 Checking..." : "➕ Thêm lịch"}
        </button>
      </div>

      {/* Media format guide */}
      <div className="text-xs bg-blue-50 border border-blue-200 rounded p-2">
        <div className="font-semibold text-blue-700 mb-1">📖 Hướng dẫn Media URLs:</div>
        <ul className="space-y-1 text-blue-600">
          <li>• Chỉ hỗ trợ HTTPS URLs</li>
          <li>• Định dạng: JPG, PNG, GIF, MP4, WEBM, etc.</li>
          <li>• Nhiều URL cách nhau bởi dấu ;</li>
          <li>• VD: https://i.imgur.com/abc.jpg;https://example.com/vid.mp4</li>
          <li>• Tối đa nên dùng 4-5 files/bài để tránh lag</li>
        </ul>
      </div>

      {message && (
        <p className="text-sm text-gray-700 bg-gray-100 p-2 rounded">{message}</p>
      )}
    </div>
  );
}