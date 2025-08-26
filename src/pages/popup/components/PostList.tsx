import type { Post } from "../utils/types";

function isValidMediaUrl(url: string): boolean {
  try {
    new URL(url);
    return /\.(jpg|jpeg|png|gif|mp4|avi|mov|webm)$/i.test(url);
  } catch {
    return false;
  }
}

export default function PostList({ posts }: { posts: Post[] }) {
  return (
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
          {post.mediaUrls?.length ? (
            <div className="mt-2">
              <div className="text-xs font-semibold text-purple-600 mb-1">
                📎 Media ({post.mediaUrls.length}):
              </div>
              <div className="space-y-1">
                {post.mediaUrls.map((url, idx) => (
                  <div key={idx} className="flex items-center text-xs">
                    <span
                      className={`inline-block w-2 h-2 rounded-full mr-2 ${
                        isValidMediaUrl(url) ? "bg-green-400" : "bg-red-400"
                      }`}
                    />
                    <span className="truncate flex-1" title={url}>
                      {url}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
