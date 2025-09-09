import { handleStartPost } from './message-handler';
import { openPostDialog } from './ui';
import type { PostJob } from '../types';

// Global posting flag to prevent duplicate START_POST handling
let isPosting = false;

// Define ContentScriptState interface outside IIFE for global access
interface ContentScriptState {
  initialized: boolean;
  initTime: number;
  version: string;
  url: string;
  messageListenerActive: boolean;
}

// Enhanced initialization tracking with IIFE to prevent global pollution
(() => {

  const win = window as Window & { __CONTENT_SCRIPT_STATE__?: ContentScriptState };
  const currentState: ContentScriptState = {
    initialized: false,
    initTime: Date.now(),
    version: '2.1.0',
    url: window.location.href,
    messageListenerActive: false
  };

  // Always reinitialize to ensure fresh state
  win.__CONTENT_SCRIPT_STATE__ = currentState;
  win.__CONTENT_SCRIPT_STATE__.initialized = true;
  
  console.log("[content] Content script initialized", {
    version: currentState.version,
    url: currentState.url
  });
  
  // Notify background script that content script is ready
  try {
    chrome.runtime.sendMessage({
      type: "CONTENT_SCRIPT_READY",
      url: currentState.url,
      timestamp: currentState.initTime
    });
  } catch (e) {
    console.warn("[content] Error notifying background script:", e);
  }
})();

// Enhanced message listener with better error handling and connection management
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // Always respond to prevent "receiving end does not exist" errors
    const respond = (response: unknown) => {
      try {
        sendResponse(response);
      } catch (e) {
        console.warn("[content] Error sending response:", e);
      }
    };

    if (message.type === "PING") {
      respond({ ok: true, ready: true, timestamp: Date.now(), url: location.href });
      return true;
    }
  
  if (message.type === "DEBUG_DIALOGS") {
    try {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>("[role='dialog']"));
      const debugInfo = {
        url: location.href,
        dialogs: dialogs.length
      };
      sendResponse(debugInfo);
    } catch (e) {
      sendResponse({ error: String(e) });
    }
    return true;
  }
  
    if (message.type === "START_POST") {
      // Prevent duplicate START_POST execution
      if (isPosting) {
        console.warn("[content] START_POST already in progress, ignoring duplicate request");
        respond({
          success: false,
          message: "Post already in progress",
          timestamp: Date.now()
        });
        return true;
      }
      
      console.log("[content] START_POST received");
      isPosting = true;

      // Process asynchronously but ensure response is sent
      (async () => {
        try {
          // Get posts from storage
          const result = await new Promise<{ postsToPost?: Partial<PostJob>[] }>((resolve) => {
            chrome.storage.local.get("postsToPost", (items) => resolve(items));
          });
          
          const storedPosts = (result.postsToPost || []) as Partial<PostJob>[];
          
          if (storedPosts.length === 0) {
            console.log("[content] No posts found in storage");
            respond({ 
              success: false, 
              message: "No posts to process",
              timestamp: Date.now()
            });
            return;
          }

          // Transform stored posts to expected format
          const posts = storedPosts.map((p: Partial<PostJob>) => ({
            content: p.content || "",
            mediaUrls: p.mediaUrls || [],
            rowId: p.rowId || '',
            time: p.time || '',
            status: p.status || 'pending' as const
          })) as PostJob[];

          // Open dialog before starting post sequence
          console.log("[content] Opening post dialog");
          const dialogOpened = await openPostDialog();
          
          if (!dialogOpened) {
            console.error("[content] Failed to open post dialog");
            respond({
              success: false,
              message: "Could not open post dialog",
              timestamp: Date.now()
            });
            return;
          }

          // Process posts with enhanced handling
          const response = await handleStartPost({
            type: "START_POST",
            posts,
            timestamp: Date.now()
          });

          // Send POST_DONE message
          if (response.success && storedPosts.length > 0) {
            const post = storedPosts[0];
            if (post.rowId) {
              chrome.runtime.sendMessage({
                type: "POST_DONE",
                rowId: post.rowId,
                status: "done"
              });
              console.log("[content] POST_DONE sent for rowId:", post.rowId);
            }
          }

          // Clear storage
          chrome.storage.local.remove("postsToPost");

          // Format user-friendly message
          const finalMessage = response.success
            ? `Posted ${response.successCount || 0} of ${storedPosts.length} items successfully`
            : response.message || "Failed to post content";

          // Send final response
          respond({
            ...response,
            message: finalMessage,
            timestamp: Date.now()
          });

        } catch (e: unknown) {
          console.error("[content] Error processing posts:", e);
          respond({
            success: false,
            message: String(e),
            error: "Error processing posts",
            timestamp: Date.now()
          });
        } finally {
          // Clear posting flag
          isPosting = false;
        }
      })();

      return true;
    }

    // Unknown message type
    respond({ success: false, message: "Unknown message type" });
    return true;
});

// Mark listener as active
(window as Window & { __CONTENT_SCRIPT_STATE__?: { messageListenerActive: boolean } }).__CONTENT_SCRIPT_STATE__!.messageListenerActive = true;