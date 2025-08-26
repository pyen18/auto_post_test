export function openFacebookAndPost(posts) {
  console.log("[Background] Opening Facebook to post:", posts.length, "posts");
  chrome.tabs.create({ url: "https://www.facebook.com/me" }, (tab) => {
    function listener(tabId, changeInfo) {
      if (tabId === tab.id && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        console.log("[Background] Facebook loaded, injecting script...");
        chrome.storage.local.set({ postsToPost: posts }, () => {
          chrome.scripting.executeScript(
            { target: { tabId }, files: ["contentScript.js"] },
            () => {
              if (chrome.runtime.lastError) {
                console.error(
                  "⚠ Inject script error:",
                  chrome.runtime.lastError.message
                );
                return;
              }
              console.log(
                "[Background] Script injected, sending START_POST message"
              );
              chrome.tabs.sendMessage(
                tabId,
                { type: "START_POST" },
                (response) => {
                  if (chrome.runtime.lastError) {
                    console.error(
                      "⚠ Send message error:",
                      chrome.runtime.lastError.message
                    );
                  } else {
                    console.log("📩 Response from content script:", response);
                  }
                }
              );
            }
          );
        });
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}
