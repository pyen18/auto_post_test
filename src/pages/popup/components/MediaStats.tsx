import type { Post } from "../utils/types";

export default function MediaStats({ posts }: { posts: Post[] }) {
  if (posts.length === 0) return null;

  return (
    <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded">
      <div className="text-sm font-semibold text-blue-700 mb-1">
        📊 Thống kê Media:
      </div>
      <div className="text-xs space-y-1">
        <div>📝 Tổng bài viết: {posts.length}</div>
        <div>🖼️ Bài có media: {posts.filter((p) => p.mediaUrls?.length).length}</div>
        <div>
          📎 Tổng media files:{" "}
          {posts.reduce((sum, p) => sum + (p.mediaUrls?.length || 0), 0)}
        </div>
      </div>
    </div>
  );
}
