console.log("[AutoPoster] contentScript loaded");

/** ======================= Utils ======================= */
/*
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function guessMimeFromUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".avi")) return "video/avi";
  return "application/octet-stream";
}
function ensureFilename(name: string, mime: string, fallbackUrl?: string): string {
  let final =
    name && name.trim() !== ""
      ? name
      : fallbackUrl
      ? new URL(fallbackUrl).pathname.split("/").pop() || "media"
      : `media_${Date.now()}`;

  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/avi": ".avi",
  };
  const wanted = map[(mime || "").toLowerCase()];
  const lower = final.toLowerCase();
  const hasKnownExt = Object.values(map).some((ext) => lower.endsWith(ext));
  if (wanted && !hasKnownExt) final += wanted;
  return final;
}
*/
function delay(ms: number) {
return new Promise((res) => setTimeout(res, ms));
}

// ======= Utils =======


function getCreatePostDialog(): HTMLElement | null {
  const dialogs = Array.from(document.querySelectorAll("[role='dialog']")) as HTMLElement[];
  for (const d of dialogs) {
    const txt = (d.textContent || "").toLowerCase();
    if (txt.includes("tạo bài viết") || txt.includes("create post") || txt.includes("đăng bài")) {
      return d;
    }
  }
  return dialogs[0] || null;
}

async function waitForDialogClose(target?: HTMLElement, timeout = 45000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const dialog = getCreatePostDialog();
    if (!dialog) return true;
    if (target && !document.body.contains(target)) return true;
    await delay(500);
  }
  return false;
}

async function openPostDialog(retries = 5): Promise<boolean> {
for (let i = 0; i < retries; i++) {
console.log("[AutoPoster] Tìm nút 'Bạn đang nghĩ gì...'");
const candidates = Array.from(
document.querySelectorAll("div[role='button'], span[role='button']"),
);


const postTrigger = candidates.find((el) => {
const text = (el.textContent || "").toLowerCase();
return (
text.includes("bạn đang nghĩ gì") ||
text.includes("tạo bài viết") ||
text.includes("what's on your mind") ||
text.includes("create post")
);
});


if (postTrigger) {
(postTrigger as HTMLElement).click();
console.log("[AutoPoster] Đã click nút 'Bạn đang nghĩ gì...'");
await delay(2000);
return true;
}


console.log(`[AutoPoster] Retry openPostDialog (${i+1}/${retries})...`);
await delay(2000);
}


console.error("[AutoPoster] Không tìm thấy nút 'Bạn đang nghĩ gì...' sau nhiều lần thử");
return false;
}
async function waitForCreatePostDialog(
  timeout = 15000, // Tăng timeout
): Promise<HTMLElement | null> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const dialogs = Array.from(
      document.querySelectorAll("[role='dialog']"),
    ) as HTMLElement[];

    for (const d of dialogs) {
      const heading = d.querySelector("h2, span, div");

      const txt = (heading?.textContent || "").toLowerCase();

      if (
        /tạo bài viết/i.test(txt) ||
        txt.includes("create post") ||
        txt.includes("đăng bài")
      ) {
        console.log("[AutoPoster] Tìm thấy dialog Tạo bài viết");

        return d;
      }
    }

    await delay(300); // Tăng delay check
  }

  console.warn(
    "[AutoPoster] Không tìm thấy dialog Tạo bài viết sau timeout",
  );

  return null;
}

// ======= Insert text robust - FIX DOUBLE CONTENT BUG =======

async function insertTextIntoContentEditable(
  editor: HTMLElement,
  text: string,
): Promise<boolean> {
  try {
    // Clear content trước khi insert để tránh double content
    editor.innerHTML = "";
    editor.textContent = "";
    
    // Focus vào editor
    editor.focus();
    
    await delay(300);

    // Method 1: Sử dụng execCommand
    const success1 = document.execCommand("selectAll", false);
    if (success1) {
      document.execCommand("delete", false);
      await delay(100);
    }
    
    const success2 = document.execCommand("insertText", false, text);
    
    if (!success2) {
      // Method 2: Fallback - tạo text node
      editor.innerHTML = "";
      const textNode = document.createTextNode(text);
      editor.appendChild(textNode);
    }

    // Trigger input events
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    editor.dispatchEvent(new Event("change", { bubbles: true }));
    
    // Đặt cursor ở cuối
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(editor);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);

    await delay(300);

    console.log("[AutoPoster] Text inserted successfully:", text.substring(0, 50));

    return true;
  } catch (err) {
    console.error("[AutoPoster] insertTextIntoContentEditable error:", err);

    return false;
  }
}

// ======= MEDIA helpers - COMPLETELY REWRITTEN =======
/*
// Enhanced file input detection
async function waitForFileInput(
  root: ParentNode,
  timeout = 15000, // Increased timeout
): Promise<HTMLInputElement | null> {
  console.log("[AutoPoster] Looking for file input...");
  const start = Date.now();

  while (Date.now() - start < timeout) {
    // Look for all input elements
    const inputs = Array.from(
      root.querySelectorAll('input[type="file"]'),
    ) as HTMLInputElement[];

    console.log(`[AutoPoster] Found ${inputs.length} file inputs`);

    // Filter for media inputs
    for (const input of inputs) {
      const accept = input.accept || "";
      const isVisible = input.offsetParent !== null || getComputedStyle(input).display !== 'none';
      const isEnabled = !input.disabled;
      
      console.log("[AutoPoster] Checking input:", {
        accept,
        isVisible,
        isEnabled,
        hasParent: !!input.parentElement
      });

      // Facebook typically doesn't set accept or uses broad accepts
      const isMediaInput = !accept || 
                          accept.includes("*") || 
                          accept.includes("image") || 
                          accept.includes("video");

      if (isMediaInput && isEnabled) {
        console.log("[AutoPoster] Found suitable file input:", input);
        return input;
      }
    }

    await delay(500); // Increased delay between checks
  }

  console.warn("[AutoPoster] No suitable file input found after timeout");
  return null;
}

// Enhanced media fetching with better error handling
function fetchMediaInBackground(url: string): Promise<{
  ok: boolean;
  name: string;
  mime: string;
  buffer?: ArrayBuffer;
  error?: string;
  originalUrl?: string;
}> {
  return new Promise((resolve) => {
    console.log("[AutoPoster] Requesting media fetch for:", url);

    const timeout = setTimeout(() => {
      console.warn("[AutoPoster] Background fetch timeout");
      resolve({
        ok: false,
        name: "",
        mime: "",
        error: "Background fetch timeout",
        originalUrl: url
      });
    }, 70000);

    chrome.runtime.sendMessage({ type: "FETCH_MEDIA", url }, (response) => {
      clearTimeout(timeout);

      if (chrome.runtime.lastError) {
        console.error("[AutoPoster] Runtime error:", chrome.runtime.lastError);
        resolve({
          ok: false,
          name: "",
          mime: "",
          error: chrome.runtime.lastError.message,
          originalUrl: url
        });
        return;
      }

      if (!response) {
        console.error("[AutoPoster] No response from background");
        resolve({
          ok: false,
          name: "",
          mime: "",
          error: "No response from background script",
          originalUrl: url
        });
        return;
      }

      // Convert base64 → ArrayBuffer
      let buffer: ArrayBuffer | undefined;
      if (response.bufferBase64) {
        try {
          buffer = base64ToArrayBuffer(response.bufferBase64);
        } catch (e) {
          console.error("[AutoPoster] base64 decode error:", e);
        }
      }

      const size = buffer ? buffer.byteLength : 0;
      console.log("[AutoPoster] Media fetch result:", {
        ok: response.ok,
        name: response.name,
        mime: response.mime,
        bufferSize: size,
        error: response.error
      });

      resolve({
        ok: response.ok,
        name: response.name,
        mime: response.mime,
        buffer,
        error: response.error,
        originalUrl: url
      });
    });
  });
}


// Enhanced file creation with validation
function createFileFromBuffer(
  buffer: ArrayBuffer,
  name: string,
  mime: string,
  originalUrl?: string
): File | null {
  try {
    if (!buffer || buffer.byteLength === 0) {
      throw new Error("Invalid buffer");
    }

    if (!mime || mime.trim() === "") {
      mime = originalUrl ? guessMimeFromUrl(originalUrl) : "application/octet-stream";
    }
    if (mime === "application/octet-stream" && name) {
      mime = guessMimeFromUrl(name);
    }

    name = ensureFilename(name, mime, originalUrl);

    const blob = new Blob([buffer], { type: mime });
    const file = new File([blob], name, { type: mime, lastModified: Date.now() });

    console.log("[AutoPoster] Created file:", {
      name: file.name,
      size: file.size,
      type: file.type
    });

    if (file.size === 0) throw new Error("Created file has zero size");

    return file;
  } catch (error) {
    console.error("[AutoPoster] Error creating file:", error);
    return null;
  }
}


// Enhanced media attachment with comprehensive error handling

async function attachMedia(
  dialog: HTMLElement,
  mediaUrls: string[],
): Promise<boolean> {
  if (!mediaUrls || mediaUrls.length === 0) {
    console.log("[AutoPoster] No media URLs to attach");
    return true;
  }

  console.log("[AutoPoster] Starting media attachment process...");
  console.log("[AutoPoster] Media URLs:", mediaUrls);

  try {
    // Step 1: Find and click photo/video button with better detection
    const photoVideoButtons = Array.from(
      dialog.querySelectorAll("div[role='button'], button, [role='button']")
    );

    const photoVideoBtn = photoVideoButtons.find(btn => {
      const text = (btn.textContent || "").toLowerCase();
      const ariaLabel = (btn as HTMLElement).getAttribute("aria-label")?.toLowerCase() || "";
      
      return text.includes("ảnh") || text.includes("video") || 
             text.includes("photo") || text.includes("media") ||
             ariaLabel.includes("photo") || ariaLabel.includes("video") ||
             ariaLabel.includes("ảnh");
    });

    if (photoVideoBtn) {
      console.log("[AutoPoster] Found photo/video button, clicking...");
      (photoVideoBtn as HTMLElement).click();
      await delay(1500); // Wait for file input to appear
    } else {
      console.warn("[AutoPoster] Photo/video button not found, proceeding anyway...");
    }

    // Step 2: Wait for file input to be available
    const input = await waitForFileInput(dialog, 15000);

    if (!input) {
      console.error("[AutoPoster] Could not find file input for media attachment");
      return false;
    }

    console.log("[AutoPoster] File input found, processing media files...");

    // Step 3: Process each media URL
    const dataTransfer = new DataTransfer();
    let successCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < mediaUrls.length; i++) {
      const url = mediaUrls[i];
      console.log(`[AutoPoster] Processing media ${i + 1}/${mediaUrls.length}: ${url}`);

      try {
        // Fetch media from background script
        const result = await fetchMediaInBackground(url);

        if (!result.ok || !result.buffer) {
          const error = `Failed to fetch ${url}: ${result.error}`;
          console.error("[AutoPoster]", error);
          errors.push(error);
          continue;
        }

        // Create file from buffer
       const file = createFileFromBuffer(
  result.buffer as ArrayBuffer,
  result.name,
  result.mime,
  result.originalUrl
);

if (!file) {
  console.error("[AutoPoster] Failed to create file for:", url);
  continue;
}

if (file.size < 1024) {
  console.warn(`[AutoPoster] File quá nhỏ (${file.size} B). Có thể fetch bị lỗi CORS / link không phải direct file.`);
}


        // Add file to data transfer
        dataTransfer.items.add(file);
        successCount++;

        console.log(`[AutoPoster] Successfully processed: ${file.name} (${file.size} bytes)`);

        // Small delay between files to avoid overwhelming the browser
        if (i < mediaUrls.length - 1) {
          await delay(200);
        }

      } catch (error) {
        const errorMsg = `Error processing ${url}: ${error}`;
        console.error("[AutoPoster]", errorMsg);
        errors.push(errorMsg);
      }
    }

    // Step 4: Check if we have any files to upload
    if (successCount === 0) {
      console.error("[AutoPoster] No media files could be processed successfully");
      console.error("[AutoPoster] Errors:", errors);
      return false;
    }

    console.log(`[AutoPoster] Successfully processed ${successCount}/${mediaUrls.length} media files`);

    // Step 5: Assign files to input and trigger events
    try {
      // Clear existing files first
      input.value = '';
      
      // Assign new files
      input.files = dataTransfer.files;

      console.log(`[AutoPoster] Assigned ${input.files?.length || 0} files to input`);

      // Trigger comprehensive events to ensure Facebook recognizes the files
      const events = [
        new Event("change", { bubbles: true, cancelable: true }),
        new Event("input", { bubbles: true, cancelable: true }),
        new Event("focus", { bubbles: true }),
        new Event("blur", { bubbles: true })
      ];

      for (const event of events) {
        input.dispatchEvent(event);
        await delay(100);
      }

      // Additional Facebook-specific events
      if (input.parentElement) {
        input.parentElement.dispatchEvent(new Event("change", { bubbles: true }));
      }

      console.log("[AutoPoster] All events dispatched, waiting for Facebook to process...");

      // Step 6: Wait for Facebook to process the files
      let processingRetries = 30; // 15 seconds max
      let filesProcessed = false;

      while (processingRetries > 0 && !filesProcessed) {
        await delay(500);
        processingRetries--;

        // Check if Facebook is showing file previews or upload progress
        const previews = dialog.querySelectorAll("img[src*='blob:'], video[src*='blob:']");
        const uploadProgress = dialog.querySelectorAll("[role='progressbar'], .upload, .uploading");
        
        if (previews.length > 0 || uploadProgress.length > 0) {
          filesProcessed = true;
          console.log("[AutoPoster] Facebook is processing media files...");
          break;
        }

        // Also check for any error indicators
        const errorIndicators = dialog.querySelectorAll(".error, [class*='error'], [class*='Error']");
        if (errorIndicators.length > 0) {
          console.warn("[AutoPoster] Detected possible upload errors");
          break;
        }
      }

      // Final wait to ensure all processing is complete
      await delay(2000);

      if (errors.length > 0) {
        console.warn("[AutoPoster] Some media files failed to process:", errors);
      }

      console.log("[AutoPoster] Media attachment process completed");
      return true;

    } catch (error) {
      console.error("[AutoPoster] Error assigning files to input:", error);
      return false;
    }

  } catch (error) {
    console.error("[AutoPoster] Error in attachMedia:", error);
    return false;
  }
}
*/


// ======= Post content to Facebook - ENHANCED =======



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


// async function postContentToFacebook(
//   content: string,
//   mediaUrls: string[],
// ): Promise<boolean> {
//   console.log("[AutoPoster] Starting post process...");
//   console.log("[AutoPoster] Content length:", content?.length || 0);
//   console.log("[AutoPoster] Media URLs count:", mediaUrls?.length || 0);

//   const dialog = await waitForCreatePostDialog(20000); // Increased timeout

//   if (!dialog) {
//     console.error("[AutoPoster] Cannot find Create Post dialog");
//     return false;
//   }

//   console.log("[AutoPoster] Post dialog found, proceeding...");

//   // Enhanced editor detection with multiple strategies
//   const editorSelectors = [
//     "div[role='textbox'][contenteditable='true']",
//     "div[contenteditable='true'][data-lexical-editor='true']", 
//     "div[contenteditable='true'][data-text='true']",
//     "div[contenteditable='true']",
//     "[contenteditable='true']",
//     ".notranslate[contenteditable='true']"
//   ];

//   let editor: HTMLElement | null = null;
//   let editorFound = false;

//   // Try multiple detection strategies
//   for (let attempt = 0; attempt < 2 && !editorFound; attempt++) {
//     console.log(`[AutoPoster] Editor detection attempt ${attempt + 1}`);

//     for (const selector of editorSelectors) {
//       const elements = Array.from(dialog.querySelectorAll(selector)) as HTMLElement[];
      
//       for (const element of elements) {
//         // Check if element is visible and interactable
//         const rect = element.getBoundingClientRect();
//         const isVisible = rect.width > 0 && rect.height > 0 && element.offsetParent !== null;
//         const isEnabled = !element.hasAttribute('disabled');
        
//         if (isVisible && isEnabled) {
//           editor = element;
//           editorFound = true;
//           console.log("[AutoPoster] Editor found with selector:", selector);
//           break;
//         }
//       }

//       if (editorFound) break;
//     }

//     if (!editorFound) {
//       console.log("[AutoPoster] Editor not found, waiting...");
//       await delay(1000);
//     }
//   }

//   if (!editor) {
//     console.error("[AutoPoster] Cannot find editor inside dialog");
//     return false;
//   }

//   // Step 1: Attach media FIRST (if any)
//   let mediaAttached = true;
//   if (mediaUrls?.length > 0) {
//     console.log("[AutoPoster] Attaching media first...");
//     mediaAttached = await attachMedia(dialog, mediaUrls);

//     if (!mediaAttached) {
//       console.warn("[AutoPoster] Media attachment failed, but continuing with text...");
//     } else {
//       console.log("[AutoPoster] Media attached successfully");
//       // Wait for media processing to complete
//       await delay(1500);
//     }
//   }

//   // Step 2: Insert text content (if any)
//   if (content?.trim()) {
//     console.log("[AutoPoster] Inserting text content...");
    
//     const textInserted = await insertTextIntoContentEditable(editor, content.trim());

//     if (!textInserted) {
//       console.error("[AutoPoster] Failed to insert text content");
//       return false;
//     }

//     console.log("[AutoPoster] Text content inserted successfully");
//   }

//   // Ensure all changes are committed
//   editor.blur();
//   await delay(800);

//   // Step 3: Find and click Post button with enhanced detection
//   console.log("[AutoPoster] Looking for Post button...");
  
//   let postButton: HTMLElement | null = null;
//   let buttonSearchRetries = 25; // Increased retries

//   while (!postButton && buttonSearchRetries > 0) {
//     const allButtons = Array.from(
//       dialog.querySelectorAll("div[role='button'], button, [role='button'], input[type='submit']"),
//     );

//     // Enhanced button detection logic
//     postButton = allButtons.find((btn) => {
//       const element = btn as HTMLElement;
//       const text = (element.textContent || "").trim().toLowerCase();
//       const ariaLabel = element.getAttribute("aria-label")?.toLowerCase() || "";
//       const ariaDisabled = element.getAttribute("aria-disabled");
//       const disabled = (element as HTMLButtonElement).disabled;
      
//       // Check if it's a post button
//       const isPostButton = 
//         /^(đăng|post|chia sẻ|share|publish)$/i.test(text) ||
//         ariaLabel.includes("post") ||
//         ariaLabel.includes("đăng") ||
//         ariaLabel.includes("publish");
      
//       // Check if button is enabled
//       const isEnabled = ariaDisabled !== "true" && !disabled;
      
//       // Check if button is visible
//       const isVisible = element.offsetParent !== null;
      
//       // Additional check for button styling (Facebook post buttons often have specific classes)
//       const hasPostButtonStyling = element.className.includes("layerConfirm") ||
//                                   element.closest("[data-testid*='post']") !== null;

//       const isValidPostButton = isPostButton && isEnabled && isVisible;
      
//       console.log("[AutoPoster] Button analysis:", {
//         text: text.substring(0, 20),
//         ariaLabel: ariaLabel.substring(0, 20),
//         ariaDisabled,
//         disabled,
//         isPostButton,
//         isEnabled,
//         isVisible,
//         hasPostButtonStyling,
//         isValidPostButton
//       });

//       return isValidPostButton;
//     }) as HTMLElement | null;

//     if (!postButton) {
//       console.log(`[AutoPoster] Post button not ready, retrying... (${buttonSearchRetries} left)`);
//       buttonSearchRetries--;
//       await delay(600);
//     }
//   }

//   if (!postButton) {
//     console.error("[AutoPoster] Could not find enabled Post button");
    
//     // Debug: List all buttons found
//     const allButtons = Array.from(dialog.querySelectorAll("div[role='button'], button"));
//     console.log("[AutoPoster] Available buttons:", allButtons.map(btn => ({
//       text: (btn.textContent || "").trim().substring(0, 30),
//       ariaDisabled: (btn as HTMLElement).getAttribute("aria-disabled"),
//       disabled: (btn as HTMLButtonElement).disabled
//     })));
    
//     return false;
//   }

//   // Wait for final validation if button was recently enabled
//   let finalRetries = 15;
//   while (postButton.getAttribute("aria-disabled") === "true" && finalRetries > 0) {
//     console.log("[AutoPoster] Waiting for post button to be fully enabled...");
//     await delay(400);
//     finalRetries--;
//   }

//   // Click the post button
//   console.log("[AutoPoster] Clicking Post button...");
  
//   try {
//     // Multiple click strategies for reliability
//     postButton.focus();
//     await delay(100);
    
//     postButton.click();
    
//     // Backup click using mouse event
//     const clickEvent = new MouseEvent('click', {
//       view: window,
//       bubbles: true,
//       cancelable: true
//     });
//     postButton.dispatchEvent(clickEvent);
    
//     console.log("[AutoPoster] Post button clicked successfully");
    
//     // Wait for post to be processed
//     await delay(3000);
    
//     return true;

//   } catch (error) {
//     console.error("[AutoPoster] Error clicking post button:", error);
//     return false;
//   }
// }


async function postContentToFacebook(content: string, mediaUrls: string[] = []): Promise<boolean> {
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
// ======= Prevent duplicate execution =======
let isProcessing = false;

// ======= Message listener - ENHANCED =======

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
if (message.type === "START_POST") {
if (isProcessing) {
console.log("[AutoPoster] Already processing, ignoring duplicate request");
sendResponse({ success: false, message: "Already processing posts" });
return;
}


isProcessing = true;


chrome.storage.local.get("postsToPost", async (result) => {
const posts: { content: string; mediaUrls?: string[] }[] =
result.postsToPost || [];


if (posts.length === 0) {
isProcessing = false;
sendResponse({ success: false, message: "Không có bài viết để đăng" });
return;
}


console.log("[AutoPoster] Starting to process", posts.length, "posts");
console.log("[AutoPoster] Posts details:", posts.map((p, i) => ({
index: i,
contentLength: p.content?.length || 0,
mediaCount: p.mediaUrls?.length || 0
})));


let successCount = 0;
const errors: string[] = [];


for (let i = 0; i < posts.length; i++) {
const post = posts[i];


console.log(`[AutoPoster] Processing post ${i + 1}/${posts.length}`);
console.log(`[AutoPoster] Post content: ${(post.content || "").substring(0, 100)}...`);
console.log(`[AutoPoster] Media URLs: ${post.mediaUrls || []}`);


try {
const dialogOpened = await openPostDialog();


if (!dialogOpened) {
const error = `Could not open post dialog for post ${i + 1}`;
console.error("[AutoPoster]", error);
errors.push(error);
break;
}


const posted = await postContentToFacebook(
post.content || "",
post.mediaUrls || [],
);


if (!posted) {
const error = `Failed to post content for post ${i + 1}`;
console.error("[AutoPoster]", error);
errors.push(error);
break;
}


successCount++;
console.log(`[AutoPoster] Successfully posted ${successCount}/${posts.length}`);


await waitForDialogClose(); // 👈 đảm bảo dialog đã đóng trước khi post tiếp theo


if (i < posts.length - 1) {
console.log("[AutoPoster] Waiting before next post...");
await delay(10000);
}


} catch (error) {
const errorMsg = `Error posting ${i + 1}: ${error}`;
console.error("[AutoPoster]", errorMsg);
errors.push(errorMsg);
break;
}
}

chrome.storage.local.remove("postsToPost");
isProcessing = false;


const finalMessage = `Đã hoàn thành đăng ${successCount}/${posts.length} bài` +
(errors.length > 0 ? `. Lỗi: ${errors.join(", ")}` : "");


console.log("[AutoPoster] Final result:", finalMessage);


sendResponse({
success: successCount > 0,
message: finalMessage,
successCount,
totalCount: posts.length,
errors: errors
});
});


return true;
}


return false;
});