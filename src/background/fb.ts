// Types
interface PostJob {
  rowId: string;
  content: string;
  mediaUrls?: string[];
}

interface PostResponse {
  success: boolean;
  successCount?: number;
  error?: string;
  message?: string;
}

interface AutoPosterState {
  lastTabId: number | null;
  lastPostTime: number;
  activeScripts: Set<string>;
}

// Extend window object for state tracking
declare global {
  interface Window {
    __AUTOPOSTER_STATE__: AutoPosterState;
  }
}

export async function openFacebookAndPost(posts: PostJob[]): Promise<PostResponse> {
  try {
    const fbUrl = "https://www.facebook.com/me/";
    let fbTab: chrome.tabs.Tab;

    // Helper function to inject content script
    const injectContentScript = async (tabId: number): Promise<void> => {
      try {
        // Remove existing content script if any
        if (chrome.scripting?.unregisterContentScripts) {
          await chrome.scripting.unregisterContentScripts({
            ids: ["autoposter-dynamic"]
          }).catch(() => {});
        }

        // Generate unique script ID for this injection
        const scriptId = `autoposter-dynamic-${Date.now()}`;
        
        // Register and inject fresh content script
        await chrome.scripting.registerContentScripts([{
          id: scriptId,
          matches: ["https://*.facebook.com/*"],
          js: ["contentScript.js"],
          runAt: "document_idle",
          world: "ISOLATED"
        }]);
        
        // Track active script ID
        if (typeof window !== 'undefined' && window.__AUTOPOSTER_STATE__) {
          window.__AUTOPOSTER_STATE__.activeScripts.add(scriptId);
        }

        // Execute the script immediately
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["contentScript.js"]
        });

        console.log("[content] Content script injected successfully");
      } catch (e) {
        console.warn("[content] Script injection error:", e);
        throw e;
      }
    };

    // Helper function to check content script
    const checkContentScript = async (tabId: number): Promise<boolean> => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(false), 2000);
        chrome.tabs.sendMessage(tabId, { type: "PING" }, (response) => {
          clearTimeout(timeout);
          resolve(!!response?.ready);
        });
      });
    };

    // Helper function to wait for tab to be ready
    const waitForTab = async (tabId: number, maxAttempts = 30): Promise<boolean> => {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          // Check tab status
          const tab = await chrome.tabs.get(tabId);
          if (tab.status !== "complete") {
            await new Promise(r => setTimeout(r, 1000));
            continue;
          }

          // Check if content script is responsive
          const isReady = await checkContentScript(tabId);
          if (isReady) {
            console.log("[content] Tab and content script ready");
            return true;
          }

          // If not ready, try to inject
          if (attempt % 5 === 0) {
            console.log("[content] Attempting content script injection");
            await injectContentScript(tabId);
          }

          await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
          console.warn("[content] Error checking tab:", e);
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      throw new Error("Tab not ready after max attempts");
    };

    // Initialize or get existing module state
    if (typeof window !== 'undefined' && typeof window.__AUTOPOSTER_STATE__ === 'undefined') {
      window.__AUTOPOSTER_STATE__ = {
        lastTabId: null,
        lastPostTime: 0,
        activeScripts: new Set<string>()
      };
    }

    // Find or create Facebook tab with state tracking
    const fbTabs = await chrome.tabs.query({ url: "*://*.facebook.com/*" });
    
    if (fbTabs.length > 0) {
      fbTab = fbTabs[0];
      // If using a previously used tab, make sure to unregister old scripts
      if (typeof window !== 'undefined' && 
          window.__AUTOPOSTER_STATE__ && 
          window.__AUTOPOSTER_STATE__.lastTabId === fbTab.id) {
        await chrome.scripting.unregisterContentScripts({
          ids: Array.from(window.__AUTOPOSTER_STATE__.activeScripts)
        }).catch(() => {});
      }
      // Update existing tab
      if (fbTab.id) {
        await chrome.tabs.update(fbTab.id, { 
          active: true, 
          url: fbUrl 
        });
      }
    } else {
      // Create new tab
      fbTab = await chrome.tabs.create({ 
        url: fbUrl, 
        active: true 
      });
    }
    
    // Update state
    if (typeof window !== 'undefined' && window.__AUTOPOSTER_STATE__ && fbTab.id) {
      window.__AUTOPOSTER_STATE__.lastTabId = fbTab.id;
    }

    // Wait for tab to be fully ready
    if (fbTab.id) {
      await waitForTab(fbTab.id);
    } else {
      throw new Error("Failed to get tab ID");
    }

    // Additional wait for Facebook UI
    await new Promise(r => setTimeout(r, 2000));

    // Enhanced message sending with retries
    const sendMessageWithRetry = async (
      tabId: number, 
      message: { type: string; postsToPost?: PostJob[] }, 
      maxRetries = 3
    ): Promise<PostResponse> => {
      for (let i = 0; i < maxRetries; i++) {
        try {
          const response = await new Promise<PostResponse>((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, message, (response) => {
              const error = chrome.runtime.lastError;
              if (error) {
                reject(error);
              } else {
                resolve(response);
              }
            });
          });
          
          return response;
        } catch (error: unknown) {
          console.warn(`[content] Message attempt ${i + 1} failed:`, error instanceof Error ? error.message : String(error));
          
          // On failure, check if tab still exists
          try {
            await chrome.tabs.get(tabId);
          } catch {
            throw new Error("Tab no longer exists");
          }
          
          // Re-inject content script
          if (i < maxRetries - 1) {
            console.log("[content] Re-injecting content script...");
            await injectContentScript(tabId);
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      }
      throw new Error("Failed to send message after retries");
    };

    // Helper function to validate JSON response
    const validateResponse = (response: unknown): PostResponse => {
      if (typeof response === 'string' && response.trim().startsWith('<')) {
        throw new Error('Received HTML instead of JSON response');
      }
      // Type guard to ensure response is PostResponse
      if (response && typeof response === 'object' && 'success' in response) {
        return response as PostResponse;
      }
      throw new Error('Invalid response format');
    };

    // Try to send the message with retries
    if (!fbTab.id) {
      throw new Error("Invalid tab ID");
    }

    const response = await sendMessageWithRetry(
      fbTab.id, 
      { type: "START_POST", postsToPost: posts }
    )
    .then(validateResponse)
    .catch((error: unknown): PostResponse => ({
      success: false,
      error: `Message failed: ${error instanceof Error ? error.message : String(error)}`
    }));

    return response;

  } catch (err: unknown) {
    console.error("[openFacebookAndPost] Error:", err);
    return {
      success: false,
      error: `Function failed: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}
