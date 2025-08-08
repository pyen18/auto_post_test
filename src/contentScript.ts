// contentScript.ts

console.log("[Auto Poster] Content script loaded.");

import type { ExtensionMessage, FetchPostsResponse, PostToWallResponse } from "./type";

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

const fetchGroupPosts = (): string[] => {
  const postSelector = 'div[data-ad-preview="message"], div[data-ad-id]';
  const postElements = document.querySelectorAll<HTMLElement>(postSelector);
  
  const posts: string[] = [];
  postElements.forEach((el, index) => {
    if (index < 5 && el.innerText) {
      posts.push(el.innerText);
    }
  });
  console.log(`[Auto Poster] Found ${posts.length} posts.`);
  return posts;
};

const performPost = async (postContent: string): Promise<void> => {
    const statusBoxTrigger = document.querySelector<HTMLElement>('div[role="button"] span:has-text("What\'s on your mind")');
    const alternativeTrigger = document.querySelector<HTMLElement>('div[role="button"][aria-label*="What\'s on your mind"]');

    const trigger = statusBoxTrigger || alternativeTrigger;
    if (!trigger) throw new Error("Không tìm thấy ô 'What's on your mind?'.");
    trigger.click();
    await delay(3000);

    const editor = document.querySelector<HTMLElement>('div[role="textbox"][aria-label*="What\'s on your mind"]');
    if (!editor) throw new Error("Không tìm thấy trình soạn thảo văn bản.");
    editor.focus();
    await delay(500);

    document.execCommand('insertText', false, postContent);
    await delay(1000);

    const postButton = document.querySelector<HTMLElement>('div[aria-label="Post"][role="button"]');
    if (!postButton) throw new Error("Không tìm thấy nút 'Post'.");
    if (postButton.getAttribute('aria-disabled') === 'true') {
      throw new Error("Nút Post bị vô hiệu hóa, có thể do nội dung trống.");
    }
    
    postButton.click();
    console.log(`[Auto Poster] Đã gửi yêu cầu đăng bài. Chờ 10 giây...`);
    await delay(10000);
};

chrome.runtime.onMessage.addListener(
  (
    request: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: FetchPostsResponse | PostToWallResponse) => void
  ) => {
    if (request.type === "FETCH_GROUP_POSTS") {
      const posts = fetchGroupPosts();
      sendResponse({ posts });
    } 
    
    else if (request.type === "POST_TO_WALL") {
      (async () => {
        try {
          window.location.href = "https://www.facebook.com/me";
          await delay(8000);

          // Chỉ đăng bài đầu tiên để kiểm tra và đảm bảo an toàn.
          // Để đăng tất cả, hãy sử dụng vòng lặp for.
          if (request.posts && request.posts.length > 0) {
             await performPost(request.posts[0]);
             sendResponse({ success: true, message: `Đã đăng thành công 1 bài viết.` });
          } else {
            throw new Error("Danh sách bài viết rỗng.");
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Đã có lỗi không xác định xảy ra.";
          console.error("[Auto Poster] Error:", message);
          sendResponse({ success: false, message });
        }
      })();
      
      return true; // Giữ message channel mở cho response bất đồng bộ.
    }
  }
);