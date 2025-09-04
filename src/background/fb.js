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

          // Register and inject fresh content script
          await chrome.scripting.registerContentScripts([{
            id: "autoposter-dynamic",
            matches: ["https://*.facebook.com/*"],
            js: ["contentScript.js"],
            runAt: "document_idle",
            world: "ISOLATED"
          }]);

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

      // Find or create Facebook tab
      const fbTabs = await chrome.tabs.query({ url: "*://*.facebook.com/*" });
      
      if (fbTabs.length > 0) {
        fbTab = fbTabs[0];
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

      // Wait for tab to be fully ready
      await waitForTab(fbTab.id);

      // Additional wait for Facebook UI
      await new Promise(r => setTimeout(r, 2000));

      // Send post request to content script
      const response = await new Promise((resolve) => {
        chrome.tabs.sendMessage(
          fbTab.id,
          { type: "START_POST", postsToPost: posts },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error("[content] Send message error:", chrome.runtime.lastError);
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(response || { success: false, error: "No response from content script" });
            }
          }
        );
      });

      resolve(response);

    } catch (err) {
      console.error("[openFacebookAndPost] Error:", err);
      reject(err);
    }
  });
}
