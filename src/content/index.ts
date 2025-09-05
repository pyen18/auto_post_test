import { handleStartPost } from './message-handler';
import { openPostDialog } from './ui';

interface WindowWithFlags extends Window {
  __AUTOPOSTER_STATE__?: {
    initialized: boolean;
    initTime: number;
    version: string;
    url: string;
  };
}

// Enhanced initialization tracking with IIFE to prevent global pollution
(() => {
  const win = window as WindowWithFlags;
  const currentState = {
    initialized: false,
    initTime: Date.now(),
    version: '1.0.0', // Update this when making major changes
    url: window.location.href
  };

  // Only initialize if not already initialized or if URL has changed
  if (!win.__AUTOPOSTER_STATE__ || 
      win.__AUTOPOSTER_STATE__.url !== currentState.url ||
      Date.now() - win.__AUTOPOSTER_STATE__.initTime > 3600000) { // Re-init after 1 hour
    
    win.__AUTOPOSTER_STATE__ = currentState;
    win.__AUTOPOSTER_STATE__.initialized = true;
  
    console.log("[content] Content script initialized", {
      url: currentState.url,
      time: new Date(currentState.initTime).toISOString(),
      version: currentState.version
    });
  } else {
    console.log("[content] Content script already active", {
      existingUrl: win.__AUTOPOSTER_STATE__.url,
      initTime: new Date(win.__AUTOPOSTER_STATE__.initTime).toISOString(),
      version: win.__AUTOPOSTER_STATE__.version
    });
  }
})();

// Enhanced message listener with better error handling
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "PING") {
    try {
      console.log("[content] PING received, script ready");
      sendResponse({ ok: true, ready: true });
    } catch (e) {
      console.error("[content] Error handling PING:", e);
      sendResponse({ ok: false, error: String(e) });
    }
    return true;
  }
  
  if (message.type === "DEBUG_DIALOGS") {
    try {
      console.log("[content] DEBUG_DIALOGS requested");
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>("[role='dialog']"));
      const composers = Array.from(document.querySelectorAll<HTMLElement>("[data-pagelet*='Composer'], [data-testid*='composer'], [data-testid*='post']"));
      const contentEditable = Array.from(document.querySelectorAll<HTMLElement>("[contenteditable='true']"));
      
      const debugInfo = {
        url: location.href,
        readyState: document.readyState,
        visibility: document.visibilityState,
        dialogs: dialogs.map((d, i) => ({
          index: i,
          text: (d.textContent || "").trim().slice(0, 100),
          ariaLabel: d.getAttribute("aria-label") || "",
          dataTestId: d.getAttribute("data-testid") || "",
          visible: d.offsetParent !== null,
          classes: d.className.slice(0, 100)
        })),
        composers: composers.map((c, i) => ({
          index: i,
          text: (c.textContent || "").trim().slice(0, 100),
          dataPagelet: c.getAttribute("data-pagelet") || "",
          dataTestId: c.getAttribute("data-testid") || "",
          visible: c.offsetParent !== null
        })),
        contentEditable: contentEditable.map((ce, i) => ({
          index: i,
          text: (ce.textContent || "").trim().slice(0, 50),
          role: ce.getAttribute("role") || "",
          dataLexical: ce.getAttribute("data-lexical-editor") || "",
          visible: ce.offsetParent !== null
        }))
      };
      
      console.log("[content] DEBUG_DIALOGS result:", debugInfo);
      sendResponse(debugInfo);
    } catch (e) {
      console.error("[content] Error in DEBUG_DIALOGS:", e);
      sendResponse({ error: String(e) });
    }
    return true;
  }
  
  if (message.type === "START_POST") {
    console.log("[content] START_POST received at", new Date().toISOString(), {
      url: location.href,
      readyState: document.readyState,
      visibility: document.visibilityState,
    });

    // Get posts from storage and process them
    chrome.storage.local.get("postsToPost", async (result) => {
      try {
        interface StoredPost {
          content?: string;
          mediaUrls?: string[];
          rowId?: string;
        }

        const storedPosts = (result.postsToPost || []) as StoredPost[];
        
        if (storedPosts.length === 0) {
          console.log("[content] No posts found in storage");
          sendResponse({ 
            success: false, 
            message: "No posts to process",
            timestamp: Date.now()
          });
          return;
        }

        // Transform stored posts to expected format
        const posts = storedPosts.map((p: StoredPost) => ({
          content: p.content || "",
          mediaUrls: p.mediaUrls || [],
          rowId: p.rowId
        }));

        // Open dialog before starting post sequence
        console.log("[content] Opening post dialog");
        const dialogOpened = await openPostDialog();
        
        if (!dialogOpened) {
          console.error("[content] Failed to open post dialog");
          sendResponse({
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

        // Update post status and clean up
        if (response.success) {
          const successfulPosts = storedPosts.slice(0, response.successCount);
          for (const post of successfulPosts) {
            if (post.rowId) {
              chrome.runtime.sendMessage({
                type: "POST_DONE",
                rowId: post.rowId,
                status: "done"
              }, (resp) => {
                console.log("[content] POST_DONE response:", resp);
              });
            }
          }
        }

        // Clear storage
        chrome.storage.local.remove("postsToPost");

        // Format user-friendly message
        const finalMessage = response.success
          ? `Posted ${response.successCount} of ${response.totalPosts} items successfully`
          : response.message || "Failed to post content";

        // Send final response
        sendResponse({
          ...response,
          message: finalMessage
        });

      } catch (e) {
        console.error("[content] Error processing posts:", e);
        sendResponse({
          success: false,
          message: String(e),
          error: "Error processing posts",
          timestamp: Date.now()
        });
      }
    });

    return true;
  }

  return false;
});