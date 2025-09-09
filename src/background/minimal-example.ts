// Minimal background script example with proper messaging
console.log("[background] Background script loaded");

// Define message types
interface ChromeMessage {
  type: string;
  posts?: unknown[];
  timestamp?: number;
  url?: string;
}

interface MessageResponse {
  success: boolean;
  message?: string;
  received?: boolean;
  ready?: boolean;
  timestamp?: number;
  url?: string;
  successCount?: number;
  dialogs?: number;
  error?: string;
}

// Handle content script ready notifications and other messages
chrome.runtime.onMessage.addListener((message: ChromeMessage, sender: chrome.runtime.MessageSender, sendResponse: (response: MessageResponse) => void) => {
  console.log("[background] Message received:", message.type, "from tab:", sender.tab?.id);
  
  try {
    if (message.type === "CONTENT_SCRIPT_READY") {
      console.log("[background] Content script ready notification:", {
        url: message.url,
        tabId: sender.tab?.id
      });
      sendResponse({ success: true, received: true });
      return true;
    }
    
    if (message.type === "START_POST") {
      console.log("[background] START_POST request received");
      handleStartPost(message, sender, sendResponse);
      return true; // Keep message channel open for async response
    }
    
    if (message.type === "DEBUG_DIALOGS") {
      console.log("[background] DEBUG_DIALOGS request received");
      handleDebugDialogs(sender, sendResponse);
      return true;
    }
    
    // Unknown message type
    console.log("[background] Unknown message type:", message.type);
    sendResponse({ success: false, message: "Unknown message type" });
    return true;
    
  } catch (error) {
    console.error("[background] Error handling message:", error);
    sendResponse({ 
      success: false, 
      error: String(error),
      message: "Background script error" 
    });
    return true;
  }
});

async function handleStartPost(message: ChromeMessage, sender: chrome.runtime.MessageSender, sendResponse: (response: MessageResponse) => void) {
  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse({ success: false, message: "No tab ID available" });
    return;
  }
  
  try {
    console.log("[background] Processing START_POST for tab:", tabId);
    
    // Send message to content script with proper error handling
    chrome.tabs.sendMessage(tabId, {
      type: "START_POST",
      posts: message.posts || [],
      timestamp: Date.now()
    }, (response: MessageResponse | undefined) => {
      if (chrome.runtime.lastError) {
        console.error("[background] Error sending to content script:", chrome.runtime.lastError.message);
        sendResponse({
          success: false,
          message: "Could not communicate with content script: " + chrome.runtime.lastError.message
        });
      } else if (!response) {
        console.error("[background] No response from content script");
        sendResponse({
          success: false,
          message: "No response from content script"
        });
      } else {
        console.log("[background] Content script response:", response);
        sendResponse(response);
      }
    });
    
  } catch (error) {
    console.error("[background] Error in handleStartPost:", error);
    sendResponse({
      success: false,
      message: "Background script error: " + String(error)
    });
  }
}

async function handleDebugDialogs(sender: chrome.runtime.MessageSender, sendResponse: (response: MessageResponse) => void) {
  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse({ success: false, message: "No tab ID available" });
    return;
  }
  
  try {
    console.log("[background] Processing DEBUG_DIALOGS for tab:", tabId);
    
    chrome.tabs.sendMessage(tabId, {
      type: "DEBUG_DIALOGS",
      timestamp: Date.now()
    }, (response: MessageResponse | undefined) => {
      if (chrome.runtime.lastError) {
        console.error("[background] Error sending DEBUG_DIALOGS:", chrome.runtime.lastError.message);
        sendResponse({
          success: false,
          message: "Could not communicate with content script: " + chrome.runtime.lastError.message
        });
      } else {
        console.log("[background] DEBUG_DIALOGS response:", response);
        sendResponse(response || { success: false, message: "No response" });
      }
    });
    
  } catch (error) {
    console.error("[background] Error in handleDebugDialogs:", error);
    sendResponse({
      success: false,
      message: "Background script error: " + String(error)
    });
  }
}

console.log("[background] Background script initialization complete");
