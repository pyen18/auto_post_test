export async function openFacebookAndPost(posts) {
  return new Promise(async (resolve, reject) => {
    try {
      const fbUrl = "https://www.facebook.com/me/";
      let fbTab;

      // Helper function to inject content script
      const injectContentScript = async (tabId) => {
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
          window.__AUTOPOSTER_STATE__.activeScripts.add(scriptId);

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
      const checkContentScript = async (tabId) => {
        return new Promise((resolve) => {
          const timeout = setTimeout(() => resolve(false), 2000);
          chrome.tabs.sendMessage(tabId, { type: "PING" }, (response) => {
            clearTimeout(timeout);
            resolve(!!response?.ready);
          });
        });
      };

      // Helper function to wait for tab to be ready
      const waitForTab = async (tabId, maxAttempts = 30) => {
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
      if (typeof window.__AUTOPOSTER_STATE__ === 'undefined') {
        window.__AUTOPOSTER_STATE__ = {
          lastTabId: null,
          lastPostTime: 0,
          activeScripts: new Set()
        };
      }

      // Find or create Facebook tab with state tracking
      const fbTabs = await chrome.tabs.query({ url: "*://*.facebook.com/*" });
      
      if (fbTabs.length > 0) {
        fbTab = fbTabs[0];
        // If using a previously used tab, make sure to unregister old scripts
        if (window.__AUTOPOSTER_STATE__.lastTabId === fbTab.id) {
          await chrome.scripting.unregisterContentScripts({
            ids: Array.from(window.__AUTOPOSTER_STATE__.activeScripts)
          }).catch(() => {});
        }
        // Update existing tab
        await chrome.tabs.update(fbTab.id, { 
          active: true, 
          url: fbUrl 
        });
      } else {
        // Create new tab
        fbTab = await chrome.tabs.create({ 
          url: fbUrl, 
          active: true 
        });
      }
      
      // Update state
      window.__AUTOPOSTER_STATE__.lastTabId = fbTab.id;

      // Wait for tab to be fully ready
      await waitForTab(fbTab.id);

      // Additional wait for Facebook UI
      await new Promise(r => setTimeout(r, 2000));

      // Enhanced message sending with retries
      const sendMessageWithRetry = async (tabId, message, maxRetries = 3) => {
        for (let i = 0; i < maxRetries; i++) {
          try {
            const response = await new Promise((resolve, reject) => {
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
          } catch (error) {
            console.warn(`[content] Message attempt ${i + 1} failed:`, error);
            
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
      const validateResponse = (response) => {
        if (typeof response === 'string' && response.trim().startsWith('<')) {
          throw new Error('Received HTML instead of JSON response');
        }
        return response;
      };

      // Try to send the message with retries
      const response = await sendMessageWithRetry(
        fbTab.id, 
        { type: "START_POST", postsToPost: posts }
      )
      .then(validateResponse)
      .catch(error => ({
        success: false,
        error: `Message failed: ${error.message}`
      }));

      resolve(response);

    } catch (err) {
      console.error("[openFacebookAndPost] Error:", err);
      reject(err);
    }
  });
}
