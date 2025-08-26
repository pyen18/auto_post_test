import { useState, useCallback } from "react";
import type { Post } from "../utils/types";

// Đổi YOUR_PROJECT_ID theo Firebase của bạn
const DB_URL = "https://autopostermmo.firebaseio.com/autoPosts.json";

type FirebasePost = {
  content: string;
  mediaUrls: string[];
  time: string;
  status: "pending" | "done";
};

export function usePosts() {
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

      if (!data) {
        setPosts([]);
        setMessage("Không có dữ liệu.");
        return;
      }

      const list: Post[] = Object.entries(data).map(([rowId, v]) => ({
        rowId,
        content: v.content,
        mediaUrls: Array.isArray(v.mediaUrls) ? v.mediaUrls : [],
        time: v.time,
        status: v.status,
      }));

      setPosts(list);
      setMessage(`Đã lấy ${list.length} bài viết`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessage("Lỗi khi lấy dữ liệu: " + msg);
    } finally {
      setLoading(false);
    }
  }, []);

  return { posts, setPosts, loading, message, setMessage, fetchPosts };
}
