// src/popup.tsx

import { useState } from "react";
import type { FC } from "react";
import type { FetchPostsResponse, PostToWallResponse } from "../type";

const Popup: FC = () => {
  const [posts, setPosts] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [status, setStatus] = useState("");

  const handleFetchPosts = () => {
    setIsLoading(true);
    setStatus("Đang lấy bài viết từ group...");
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab?.id) {
        setStatus("Lỗi: Không tìm thấy tab hoạt động.");
        setIsLoading(false);
        return;
      }

      chrome.tabs.sendMessage(
        activeTab.id,
        { type: "FETCH_GROUP_POSTS" },
        (response: FetchPostsResponse | undefined) => {
          setIsLoading(false);
          if (chrome.runtime.lastError) {
            setStatus("Lỗi: Không thể kết nối. Hãy đảm bảo bạn đang ở trong group và tải lại trang.");
            console.error(chrome.runtime.lastError.message);
            return;
          }

          if (response && response.posts && response.posts.length > 0) {
            setPosts(response.posts);
            setStatus(`Đã lấy thành công ${response.posts.length} bài viết!`);
          } else {
            setStatus("Không tìm thấy bài viết nào. Hãy thử cuộn trang xuống một chút.");
          }
        }
      );
    });
  };

  const handlePostToFacebook = () => {
    if (posts.length === 0) {
      setStatus("Chưa có bài viết nào để đăng.");
      return;
    }
    setIsPosting(true);
    setStatus("Bắt đầu quá trình đăng bài...");

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) {
        setIsPosting(false);
        setStatus("Lỗi: Không tìm thấy tab hoạt động.");
        return;
      }
      
      chrome.tabs.sendMessage(
        tabId,
        { type: "POST_TO_WALL", posts: posts },
        (response: PostToWallResponse) => {
          setIsPosting(false);
          if (chrome.runtime.lastError) {
            setStatus("Lỗi khi gửi yêu cầu đăng bài: " + chrome.runtime.lastError.message);
            return;
          }
          if (response.success) {
            setStatus("Hoàn thành! " + response.message);
          } else {
            setStatus("Đăng bài thất bại: " + response.message);
          }
        }
      );
    });
  };

  return (
    <div className="p-4 w-[450px] text-sm font-sans bg-gray-50">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-gray-800">FB Auto Poster</h1>
        <span className="text-xs text-gray-500">v1.0</span>
      </div>

      <div className="space-y-4">
        <button
          className="w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors disabled:bg-blue-300 shadow-sm"
          onClick={handleFetchPosts}
          disabled={isLoading || isPosting}
        >
          {isLoading ? "Đang lấy..." : "1. Lấy 5 bài viết từ Group"}
        </button>

        <div className="p-2 border rounded-md bg-white min-h-[120px] max-h-48 overflow-auto">
          {posts.length > 0 ? (
            <ul className="space-y-2">
              {posts.map((p, i) => (
                <li key={i} className="p-2 text-xs bg-gray-50 rounded shadow-sm break-words border-l-2 border-blue-500">
                  {p.substring(0, 100)}...
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center justify-center h-full">
                <p className="text-gray-400 text-center py-8">Chưa có bài viết nào</p>
            </div>
          )}
        </div>

        <button
          className="w-full bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 transition-colors disabled:bg-green-300 shadow-sm"
          onClick={handlePostToFacebook}
          disabled={isLoading || isPosting || posts.length === 0}
        >
          {isPosting ? "Đang đăng..." : "2. Đăng bài lên tường cá nhân"}
        </button>

        {status && <p className="text-center text-xs text-gray-600 bg-gray-100 p-2 rounded-md">{status}</p>}
      </div>
    </div>
  );
};

export default Popup;