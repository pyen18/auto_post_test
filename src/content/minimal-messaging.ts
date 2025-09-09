// Minimal content script with proper Chrome extension messaging
console.log("[content] Content script loaded");

// Define message types for type safety
interface ChromeMessage {
  type: string;
  posts?: unknown[];
  timestamp?: number;
}

interface MessageResponse {
  success: boolean;
  message?: string;
  ready?: boolean;
  timestamp?: number;
  url?: string;
  successCount?: number;
  dialogs?: number;
  error?: string;
}

// Enhanced message listener with proper error handling
chrome.runtime.onMessage.addListener((message: ChromeMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response: MessageResponse) => void) => {
  console.log("[content] Message received:", message.type);
  
  try {
    if (message.type === "PING") {
      console.log("[content] PING received, responding with ready status");
      sendResponse({ 
        success: true, 
        ready: true, 
        timestamp: Date.now(),
        url: location.href 
      });
      return true;
    }
    
    if (message.type === "START_POST") {
      console.log("[content] START_POST received");
      // Simulate post processing
      setTimeout(() => {
        sendResponse({
          success: true,
          message: "Post completed successfully",
          successCount: 1
        });
      }, 1000);
      return true; // Keep message channel open for async response
    }
    
    if (message.type === "DEBUG_DIALOGS") {
      console.log("[content] DEBUG_DIALOGS requested");
      const dialogs = document.querySelectorAll('[role="dialog"]');
      sendResponse({
        success: true,
        dialogs: dialogs.length,
        url: location.href
      });
      return true;
    }
    
    // Unknown message type
    console.log("[content] Unknown message type:", message.type);
    sendResponse({ success: false, message: "Unknown message type" });
    return true;
    
  } catch (error) {
    console.error("[content] Error handling message:", error);
    sendResponse({ 
      success: false, 
      error: String(error),
      message: "Content script error" 
    });
    return true;
  }
});

// Notify background script that content script is ready
chrome.runtime.sendMessage({
  type: "CONTENT_SCRIPT_READY",
  url: location.href,
  timestamp: Date.now()
}, (response: unknown) => {
  if (chrome.runtime.lastError) {
    console.warn("[content] Failed to notify background:", chrome.runtime.lastError.message);
  } else {
    console.log("[content] Successfully notified background script:", response);
  }
});

console.log("[content] Content script initialization complete");
