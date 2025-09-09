import { base64ToArrayBuffer, ensureFilename, guessMimeFromUrl,delay } from "./utils";


export function fetchMediaInBackground(url: string): Promise<{
  ok: boolean;
  name: string;
  mime: string;
  buffer?: ArrayBuffer;
  error?: string;
  originalUrl?: string;
}> {
  return new Promise((resolve) => {
    console.log("[content] Requesting media download for:", url);

    const timeout = setTimeout(() => {
        console.warn("[content] Background media download timeout");
      resolve({
        ok: false,
        name: "",
        mime: "",
        error: "Background fetch timeout",
        originalUrl: url
      });
    }, 70000);

    chrome.runtime.sendMessage({ type: "DOWNLOAD_MEDIA", url }, (response: { ok: boolean; bufferBase64?: string; name: string; mime: string; error?: string }) => {
      clearTimeout(timeout);

      if (chrome.runtime.lastError) {
        console.error("[content] Runtime error:", chrome.runtime.lastError);
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
        console.error("[content] No response from background");
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
        } catch (e: unknown) {
          console.error("[content] base64 decode error:", e);
        }
      }

      const size = buffer ? buffer.byteLength : 0;
      console.log("[content] Media download result:", {
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

export async function waitForFileInput(
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

export function createFileFromBuffer(
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
  } catch (error: unknown) {
    console.error("[AutoPoster] Error creating file:", error);
    return null;
  }
}

export async function attachMedia(
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
    // Step 1: Find and click photo/video button
    const photoVideoButtons = Array.from(
      dialog.querySelectorAll("div[role='button'], button, [role='button']")
    );

    const photoVideoBtn = photoVideoButtons.find(btn => {
      const text = (btn.textContent || "").toLowerCase();
      const ariaLabel =
        (btn as HTMLElement).getAttribute("aria-label")?.toLowerCase() || "";

      return (
        text.includes("ảnh") ||
        text.includes("video") ||
        text.includes("photo") ||
        text.includes("media") ||
        ariaLabel.includes("photo") ||
        ariaLabel.includes("video") ||
        ariaLabel.includes("ảnh")
      );
    });

    if (photoVideoBtn) {
      console.log("[AutoPoster] Found photo/video button, clicking...");
      (photoVideoBtn as HTMLElement).click();
      await delay(1500);
    } else {
      console.warn("[AutoPoster] Photo/video button not found, proceeding anyway...");
    }

    // Step 2: Wait for file input
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
        const result = await fetchMediaInBackground(url);
        if (!result.ok || !result.buffer) {
          const error = `Failed to fetch ${url}: ${result.error}`;
          console.error("[AutoPoster]", error);
          errors.push(error);
          continue;
        }

        // ❌ Skip GIF upload
        if (result.mime.includes("gif")) {
          console.warn("[AutoPoster] GIF detected, skipping file upload. Will paste URL into content:", url);

          // Chèn thẳng link GIF vào nội dung
          const editor = dialog.querySelector("[contenteditable='true']") as HTMLElement;
          if (editor) {
            editor.focus();
            editor.textContent += " " + url;

            editor.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                cancelable: true,
                inputType: "insertText",
                data: url,
              })
            );
          }
          continue;
        }

        // ✅ Normal image/video
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

        dataTransfer.items.add(file);
        successCount++;
        console.log(`[AutoPoster] Successfully processed: ${file.name} (${file.size} bytes)`);

        if (i < mediaUrls.length - 1) await delay(200);
      } catch (error: unknown) {
        const errorMsg = `Error processing ${url}: ${error}`;
        console.error("[AutoPoster]", errorMsg);
        errors.push(errorMsg);
      }
    }

    // Step 4: Check files
    if (successCount === 0 && errors.length > 0) {
      console.error("[AutoPoster] No media files could be processed successfully");
      console.error("[AutoPoster] Errors:", errors);
      return false;
    }

    // Step 5: Assign files
    if (successCount > 0) {
      try {
        input.value = "";
        input.files = dataTransfer.files;
        console.log(`[AutoPoster] Assigned ${input.files?.length || 0} files to input`);

        const events = [
          new Event("change", { bubbles: true, cancelable: true }),
          new Event("input", { bubbles: true, cancelable: true }),
        ];

        for (const event of events) {
          input.dispatchEvent(event);
          await delay(100);
        }

        if (input.parentElement) {
          input.parentElement.dispatchEvent(new Event("change", { bubbles: true }));
        }

        console.log("[AutoPoster] All events dispatched, waiting for Facebook to process...");

        let retries = 30;
        let filesProcessed = false;

        while (retries > 0 && !filesProcessed) {
          await delay(500);
          retries--;

          const previews = dialog.querySelectorAll("img[src*='blob:'], video[src*='blob:']");
          const uploadProgress = dialog.querySelectorAll("[role='progressbar'], .upload, .uploading");

          if (previews.length > 0 || uploadProgress.length > 0) {
            filesProcessed = true;
            console.log("[AutoPoster] Facebook is processing media files...");
            break;
          }

          const errorIndicators = dialog.querySelectorAll(".error, [class*='error'], [class*='Error']");
          if (errorIndicators.length > 0) {
            console.warn("[AutoPoster] Detected possible upload errors");
            break;
          }
        }

        await delay(2000);
      } catch (error: unknown) {
        console.error("[AutoPoster] Error assigning files to input:", error);
        return false;
      }
    }

    if (errors.length > 0) {
      console.warn("[AutoPoster] Some media files failed to process:", errors);
    }

    console.log("[AutoPoster] Media attachment process completed");
    return true;
  } catch (error: unknown) {
    console.error("[AutoPoster] Error in attachMedia:", error);
    return false;
  }
}

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


export function insertUrlAsText(editor: HTMLElement, url: string) {
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


// Legacy function - use fetchMediaInBackground instead
async function downloadMedia(url: string): Promise<Blob | null> {
  const result = await fetchMediaInBackground(url);
  if (result.ok && result.buffer) {
    return new Blob([result.buffer], { type: result.mime });
  }
  return null;
}


// ====== Upload media vào Facebook dialog ======
export async function uploadMedia(dialog: HTMLElement, mediaUrls: string[]): Promise<boolean> {
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
  } catch (err: unknown) {
    console.error("[AutoPoster] uploadMedia error:", err);
    return false;
  }
}