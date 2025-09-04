import { useState, useCallback, useEffect } from "react";
import type { Post } from "../utils/types";

// Đổi YOUR_PROJECT_ID thành Firebase project của bạn
const DB_URL = "https://autopostermmo-default-rtdb.firebaseio.com/autoPosts.json";

// Định nghĩa type cho dữ liệu từ Firebase
type FirebasePost = {
  content: string;
  mediaUrls: string[] | string;
  time: string;
  status: "pending" | "done" | "failed";
};

// Định nghĩa type cho Chrome runtime messages
type ChromeMessage = {
  type: "SYNC_DONE";
  payload?: Record<string, Post>;
};

export function usePosts(autoFetch = true) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

const fetchPosts = useCallback(async () => {
  setLoading(true);
  setMessage("");
  try {
    const res = await fetch(DB_URL);
    if (!res.ok) throw new Error(`Fetch DB failed: ${res.status}`);
    const data: Record<string, FirebasePost> | null = await res.json();

    let list: Post[] = [];

    if (data) {
      list = Object.entries(data).map(([rowId, v]) => ({
        rowId,
        content: v.content || "",
        mediaUrls: Array.isArray(v.mediaUrls)
          ? v.mediaUrls
          : typeof v.mediaUrls === "string" && v.mediaUrls.trim() !== ""
          ? v.mediaUrls.split(";").map((s) => s.trim())
          : [],
        time: v.time || "",
        status:
          v.status === "done" || v.status === "failed" ? v.status : "pending",
      }));
      console.log("[usePosts] Loaded from Firebase:", list);
    } else {
      // ✅ fallback: đọc cache từ chrome.storage.local
      await new Promise<void>((resolve) => {
        chrome.storage.local.get(["autoPostsCache"], (items) => {
          const cache = items.autoPostsCache || {};
          list = Object.values(cache);
          console.log("[usePosts] Loaded from local cache:", list);
          resolve();
        });
      });
    }

    setPosts(list);
    setMessage(
      list.length > 0
        ? `Đã lấy ${list.length} bài viết.`
        : "Không có dữ liệu trong DB hoặc cache."
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setMessage("Lỗi khi lấy dữ liệu: " + msg);
  } finally {
    setLoading(false);
  }
}, []);


  // Optional: tự động fetch lần đầu
  useEffect(() => {
    if (autoFetch) {
      fetchPosts();
    }
  }, [autoFetch, fetchPosts]);
  useEffect(() => {
  function handleMessage(msg: ChromeMessage) {
    if (msg.type === "SYNC_DONE") {
      console.log("[usePosts] Got SYNC_DONE:", msg.payload);
      const list: Post[] = Object.values(msg.payload || {});
      setPosts(list);
      setMessage(`Đã sync xong, có ${list.length} bài viết.`);
    }
  }

  chrome.runtime.onMessage.addListener(handleMessage);
  return () => {
    chrome.runtime.onMessage.removeListener(handleMessage);
  };
}, []);


  return { posts, setPosts, loading, message, setMessage, fetchPosts };

}
