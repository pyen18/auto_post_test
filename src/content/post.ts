
import { delay } from "./utils";
import {  waitForCreatePostDialog,insertTextIntoContentEditable } from "./ui";
// import { attachMedia } from "./media";



// test paste link 


async function validateImageSize(blob: Blob, minWidth = 200, minHeight = 200): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const valid = img.width >= minWidth && img.height >= minHeight;
      URL.revokeObjectURL(url);
      resolve(valid);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(false);
    };
    img.src = url;
  });
}

async function resizeImage(blob: Blob, targetW = 400, targetH = 400): Promise<Blob> {
  const img = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  ctx?.drawImage(img, 0, 0, targetW, targetH);
  return new Promise((resolve) => {
    canvas.toBlob((newBlob) => resolve(newBlob!), blob.type);
  });
}


function insertUrlAsText(editor: HTMLElement, url: string) {
  editor.focus();
  editor.innerHTML = "";

  const success = document.execCommand("insertText", false, url);
  if (!success) {
    const textNode = document.createTextNode(url);
    editor.appendChild(textNode);
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
  } else {
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }

  console.log("[AutoPoster] URL inserted into editor:", url);
}


// ====== Download media từ URL ======
async function downloadMedia(url: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "DOWNLOAD_MEDIA", url }, (res) => {
      if (res?.success) {
        const arr = res.data.split(",");
        const mime = res.type || "application/octet-stream";
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) u8arr[n] = bstr.charCodeAt(n);
        resolve(new Blob([u8arr], { type: mime }));
      } else {
        resolve(null);
      }
    });
  });
}


// ====== Upload media vào Facebook dialog ======
async function uploadMedia(dialog: HTMLElement, mediaUrls: string[]): Promise<boolean> {
  try {
    const fileInput = dialog.querySelector<HTMLInputElement>("input[type='file'][multiple]");
    if (!fileInput) {
      console.error("[AutoPoster] Không tìm thấy input file trong dialog");
      return false;
    }

    const dataTransfer = new DataTransfer();

    for (const url of mediaUrls) {
      const blob = await downloadMedia(url);
      if (!blob) {
        console.warn("[AutoPoster] Không tải được media:", url);
        continue;
      }

      let finalBlob = blob;

      const ok = await validateImageSize(blob);
      if (!ok) {
        console.warn("[AutoPoster] Image too small, resizing:", url);
        finalBlob = await resizeImage(blob, 400, 400);
      }

      const ext = blob.type.includes("gif") ? "gif" : "jpg";
      const file = new File([finalBlob], `upload.${ext}`, { type: blob.type });

      dataTransfer.items.add(file);
      await delay(500); // cho FB xử lý dần
    }

    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));

    console.log("[AutoPoster] Media uploaded:", mediaUrls);
    return true;
  } catch (err) {
    console.error("[AutoPoster] uploadMedia error:", err);
    return false;
  }
}




// test post 
export async function postContentToFacebook(content: string, mediaUrls: string[] = []): Promise<boolean> {
  console.log("[AutoPoster] Waiting for Create Post dialog...");
  const dialog = await waitForCreatePostDialog(10000);
  if (!dialog) return false;

  // Tìm editor
  const editorSelectors = [
    "div[role='textbox'][contenteditable='true']",
    "div[contenteditable='true'][data-lexical-editor='true']",
    "div[contenteditable='true']",
  ];
  let editor: HTMLElement | null = null;
  for (const sel of editorSelectors) {
    const found = dialog.querySelector(sel) as HTMLElement | null;
    if (found) { editor = found; break; }
  }
  if (!editor) return false;

  // Nếu content là URL -> paste, nếu không thì insert text
  const isUrl = /^https?:\/\/\S+$/.test(content.trim());
  if (isUrl) {
    insertUrlAsText(editor, content.trim());
  } else {
    insertTextIntoContentEditable(editor, content);
  }

  // Upload nhiều media nếu có
  for (const url of mediaUrls) {
    const blob = await downloadMedia(url);
    if (blob) {
      await uploadMedia(dialog, mediaUrls);
      await delay(1000); // delay nhỏ cho FB xử lý mỗi file
    }
    if (!blob) continue;
    let finalBlob = blob;
      const ok = await validateImageSize(blob);
  if (!ok) {
    console.warn("[AutoPoster] Image too small, resizing:", url);
    finalBlob = await resizeImage(blob, 400, 400); // resize lên 400x400
  }

  const dataTransfer = new DataTransfer();
  const file = new File([finalBlob], "image.jpg", { type: blob.type });
  dataTransfer.items.add(file);
}

  await delay(2000); // đợi preview hiện

  // Click nút Đăng
  const postBtn = Array.from(dialog.querySelectorAll("div[role='button'], button"))
    .find(btn => {
      const txt = (btn.textContent || "").trim().toLowerCase();
      const disabled = (btn as HTMLElement).getAttribute("aria-disabled");
      return (txt === "đăng" || txt === "post") && disabled !== "true";
    }) as HTMLElement | undefined;

  if (!postBtn) {
    console.error("[AutoPoster] Không tìm thấy nút Đăng");
    return false;
  }

  postBtn.click();
  console.log("[AutoPoster] Đã click Đăng");
  return true;
}



/// Function to download media from a URL
/*
export async function postContentToFacebook(
  content: string,
  mediaUrls: string[],
): Promise<boolean> {
  console.log("[AutoPoster] Starting post process...");
  console.log("[AutoPoster] Content length:", content?.length || 0);
  console.log("[AutoPoster] Media URLs count:", mediaUrls?.length || 0);

  const dialog = await waitForCreatePostDialog(20000); // Increased timeout
  if (!dialog) {
    console.error("[AutoPoster] Cannot find Create Post dialog");
    return false;
  }

  console.log("[AutoPoster] Post dialog found, proceeding...");

  // Enhanced editor detection with multiple strategies
  const editorSelectors = [
    "div[role='textbox'][contenteditable='true']",
    "div[contenteditable='true'][data-lexical-editor='true']", 
    "div[contenteditable='true'][data-text='true']",
    "div[contenteditable='true']",
    "[contenteditable='true']",
    ".notranslate[contenteditable='true']"
  ];

  let editor: HTMLElement | null = null;
  let editorFound = false;

  // Try multiple detection strategies
  for (let attempt = 0; attempt < 2 && !editorFound; attempt++) {
    console.log(`[AutoPoster] Editor detection attempt ${attempt + 1}`);

    for (const selector of editorSelectors) {
      const elements = Array.from(dialog.querySelectorAll(selector)) as HTMLElement[];
      
      for (const element of elements) {
        // Check if element is visible and interactable
        const rect = element.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0 && element.offsetParent !== null;
        const isEnabled = !element.hasAttribute('disabled');
        if (isVisible && isEnabled) {
          editor = element;
          editorFound = true;
          console.log("[AutoPoster] Editor found with selector:", selector);
          break;
        }
      }

      if (editorFound) break;
    }
    if (!editorFound) {
      console.log("[AutoPoster] Editor not found, waiting...");
      await delay(1000);
    }
  }
  if (!editor) {
    console.error("[AutoPoster] Cannot find editor inside dialog");
    return false;
  }

  // Step 1: Attach media FIRST (if any)
  let mediaAttached = true;
  if (mediaUrls?.length > 0) {
    console.log("[AutoPoster] Attaching media first...");
    mediaAttached = await attachMedia(dialog, mediaUrls);

    if (!mediaAttached) {
      console.warn("[AutoPoster] Media attachment failed, but continuing with text...");
    } else {
      console.log("[AutoPoster] Media attached successfully");
      // Wait for media processing to complete
      await delay(1500);
    }
  }

  // Step 2: Insert text content (if any)
  if (content?.trim()) {
    console.log("[AutoPoster] Inserting text content...");
    
    const textInserted = await insertTextIntoContentEditable(editor, content.trim());

    if (!textInserted) {
      console.error("[AutoPoster] Failed to insert text content");
      return false;
    }

    console.log("[AutoPoster] Text content inserted successfully");
  }

  // Ensure all changes are committed
  editor.blur();
  await delay(800);

  // Step 3: Find and click Post button with enhanced detection
  console.log("[AutoPoster] Looking for Post button...");
  
  let postButton: HTMLElement | null = null;
  let buttonSearchRetries = 25; // Increased retries

  while (!postButton && buttonSearchRetries > 0) {
    const allButtons = Array.from(
      dialog.querySelectorAll("div[role='button'], button, [role='button'], input[type='submit']"),
    );

    // Enhanced button detection logic
    postButton = allButtons.find((btn) => {
      const element = btn as HTMLElement;
      const text = (element.textContent || "").trim().toLowerCase();
      const ariaLabel = element.getAttribute("aria-label")?.toLowerCase() || "";
      const ariaDisabled = element.getAttribute("aria-disabled");
      const disabled = (element as HTMLButtonElement).disabled;
      
      // Check if it's a post button
      const isPostButton = 
        /^(đăng|post|chia sẻ|share|publish)$/i.test(text) ||
        ariaLabel.includes("post") ||
        ariaLabel.includes("đăng") ||
        ariaLabel.includes("publish");
      
      // Check if button is enabled
      const isEnabled = ariaDisabled !== "true" && !disabled;
      
      // Check if button is visible
      const isVisible = element.offsetParent !== null;
      
      // Additional check for button styling (Facebook post buttons often have specific classes)
      const hasPostButtonStyling = element.className.includes("layerConfirm") ||
                                  element.closest("[data-testid*='post']") !== null;

      const isValidPostButton = isPostButton && isEnabled && isVisible;
      
      console.log("[AutoPoster] Button analysis:", {
        text: text.substring(0, 20),
        ariaLabel: ariaLabel.substring(0, 20),
        ariaDisabled,
        disabled,
        isPostButton,
        isEnabled,
        isVisible,
        hasPostButtonStyling,
        isValidPostButton
      });

      return isValidPostButton;
    }) as HTMLElement | null;

    if (!postButton) {
      console.log(`[AutoPoster] Post button not ready, retrying... (${buttonSearchRetries} left)`);
      buttonSearchRetries--;
      await delay(600);
    }
  }

  if (!postButton) {
    console.error("[AutoPoster] Could not find enabled Post button");
    
    // Debug: List all buttons found
    const allButtons = Array.from(dialog.querySelectorAll("div[role='button'], button"));
    console.log("[AutoPoster] Available buttons:", allButtons.map(btn => ({
      text: (btn.textContent || "").trim().substring(0, 30),
      ariaDisabled: (btn as HTMLElement).getAttribute("aria-disabled"),
      disabled: (btn as HTMLButtonElement).disabled
    })));
    
    return false;
  }

  // Wait for final validation if button was recently enabled
  let finalRetries = 15;
  while (postButton.getAttribute("aria-disabled") === "true" && finalRetries > 0) {
    console.log("[AutoPoster] Waiting for post button to be fully enabled...");
    await delay(400);
    finalRetries--;
  }

  // Click the post button
  console.log("[AutoPoster] Clicking Post button...");
  
  try {
    // Multiple click strategies for reliability
    postButton.focus();
    await delay(100);
    
    postButton.click();
    
    // Backup click using mouse event
    const clickEvent = new MouseEvent('click', {
      view: window,
      bubbles: true,
      cancelable: true
    });
    postButton.dispatchEvent(clickEvent);
    
    console.log("[AutoPoster] Post button clicked successfully");
    
    // Wait for post to be processed
    await delay(3000);
    
    return true;

  } catch (error) {
    console.error("[AutoPoster] Error clicking post button:", error);
    return false;
  }
}
*/