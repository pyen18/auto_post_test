
import { delay } from './utils';
import { waitForCreatePostDialog, insertTextIntoContentEditable } from './ui';

// Types and Interfaces
interface ImageValidationOptions {
  minWidth?: number;
  minHeight?: number;
}

interface DownloadResponse {
  success: boolean;
  data: string;
  type?: string;
}

// Constants
const CONSTANTS = {
  // Timing constants
  MAX_ATTEMPTS: 30,
  CLICK_DELAY: 500,
  PROCESSING_TIMEOUT: 20000,
  UPLOAD_DELAY: 300,
  CLICK_COOLDOWN: 3000,
  MAX_POST_CLICKS: 3,
  DIALOG_TIMEOUT: 15000,
  
  // Image constants
  MIN_IMAGE_WIDTH: 200,
  MIN_IMAGE_HEIGHT: 200,
  TARGET_IMAGE_WIDTH: 400,
  TARGET_IMAGE_HEIGHT: 400,
  IMAGE_QUALITY: 0.95,
  
  // UI constants
  VERIFY_ATTEMPTS: 20,
  LOG_INTERVAL: 5
} as const;

// Helper Functions
export function isElementVisible(element: HTMLElement): boolean {
  if (!element.isConnected || !element.offsetParent || 
      element.offsetWidth === 0 || element.offsetHeight === 0) {
    return false;
  }

  const style = window.getComputedStyle(element);
  return style.display !== 'none' && 
         style.visibility !== 'hidden' && 
         style.opacity !== '0';
}

export function toHTMLElement(element: Element | null): HTMLElement | null {
  return element instanceof HTMLElement ? element : null;
}

export function normalizeText(str: string): string {
  return str.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function findSpanByText(container: HTMLElement, text: string): HTMLElement | null {
  const targetText = normalizeText(text);
  
  // First try exact matches
  const exactMatch = Array.from(container.querySelectorAll('span'))
    .find(el => normalizeText(el.textContent || '') === targetText);
  if (exactMatch) return exactMatch as HTMLElement;
  
  // Then try contains matches with specific parent class checks
  const containsMatch = Array.from(container.querySelectorAll('span'))
    .find(el => {
      const elText = normalizeText(el.textContent || '');
      const hasRelevantParent = el.closest('.x1ja2u2z, .xdj266r, .x9f619');
      return elText.includes(targetText) && hasRelevantParent;
    });
  
  return containsMatch as HTMLElement || null;
}

// Image Handling Functions
async function validateImageSize(blob: Blob, options: ImageValidationOptions = {}): Promise<boolean> {
  const { 
    minWidth = CONSTANTS.MIN_IMAGE_WIDTH, 
    minHeight = CONSTANTS.MIN_IMAGE_HEIGHT 
  } = options;
  
  try {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    
    const valid = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(img.width >= minWidth && img.height >= minHeight);
      img.onerror = () => resolve(false);
      img.src = url;
    });
    
    URL.revokeObjectURL(url);
    return valid;
  } catch (error) {
    console.error('[AutoPoster] Image validation error:', error);
    return false;
  }
}

async function resizeImage(
  blob: Blob, 
  targetW = CONSTANTS.TARGET_IMAGE_WIDTH, 
  targetH = CONSTANTS.TARGET_IMAGE_HEIGHT
): Promise<Blob> {
  try {
    const img = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');
    
    ctx.drawImage(img, 0, 0, targetW, targetH);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (newBlob) => newBlob ? resolve(newBlob) : reject(new Error('Failed to create blob')),
        'image/jpeg',
        CONSTANTS.IMAGE_QUALITY
      );
    });
  } catch (error) {
    console.error('[AutoPoster] Image resize error:', error);
    throw error;
  }
}

// Media Handling Functions
async function downloadMedia(url: string): Promise<Blob | null> {
  try {
    const response = await new Promise<DownloadResponse>((resolve) => {
      chrome.runtime.sendMessage({ type: 'DOWNLOAD_MEDIA', url }, resolve);
    });

    if (!response?.success) {
      console.warn('[AutoPoster] Media download failed:', url);
      return null;
    }

    const [, base64Data] = response.data.split(',');
    const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    return new Blob([bytes], { type: response.type || 'application/octet-stream' });
  } catch (error) {
    console.error('[AutoPoster] Media download error:', url, error);
    return null;
  }
}

async function uploadMedia(dialog: HTMLElement, mediaUrls: string[]): Promise<boolean> {
  const fileInput = dialog.querySelector<HTMLInputElement>("input[type='file'][multiple]");
  if (!fileInput) {
    console.error("[AutoPoster] File input not found in dialog");
    return false;
  }

  try {
    const dataTransfer = new DataTransfer();
    let successCount = 0;

    for (const url of mediaUrls) {
      const blob = await downloadMedia(url);
      if (!blob) continue;

      const finalBlob = !(await validateImageSize(blob)) 
        ? await resizeImage(blob)
        : blob;

      const ext = blob.type.includes('gif') ? 'gif' : 'jpg';
      dataTransfer.items.add(
        new File([finalBlob], `upload_${successCount}.${ext}`, { type: blob.type })
      );
      successCount++;
      await delay(CONSTANTS.UPLOAD_DELAY);
    }

    if (successCount === 0) {
      console.warn("[AutoPoster] No media files were successfully processed");
      return false;
    }

    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    
    console.log(`[AutoPoster] ${successCount}/${mediaUrls.length} media files uploaded`);
    return true;
  } catch (error) {
    console.error("[AutoPoster] Media upload error:", error);
    return false;
  }
}

// Text Handling Functions
function insertUrlAsText(editor: HTMLElement, url: string): void {
  editor.focus();
  editor.innerHTML = '';

  try {
    if (!document.execCommand('insertText', false, url)) {
      editor.textContent = url;
    }
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
  } catch {
    editor.textContent = url;
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
}

export const postContentToFacebook = (() => {
  return async function(content: string, mediaUrls: string[] = []): Promise<boolean> {
    console.log("[AutoPoster] Initiating post:", {
      contentLength: content?.length,
      mediaCount: mediaUrls?.length,
      url: location.href
    });

    // Wait for and validate dialog
    const dialog = await waitForCreatePostDialog(CONSTANTS.PROCESSING_TIMEOUT);
    if (!dialog) {
      console.error("[AutoPoster] Create Post dialog not found", {
        dialogs: document.querySelectorAll("[role='dialog']").length,
        composers: document.querySelectorAll("[data-pagelet*='Composer']").length,
        readyState: document.readyState
      });
      return false;
    }

    // Find editor with prioritized selectors
    const editor = [
      "div[role='textbox'][contenteditable='true']",
      "div[contenteditable='true'][data-lexical-editor='true']",
      "div[contenteditable='true'][data-text='true']",
      "div[contenteditable='true']"
    ].reduce<HTMLElement|null>((found, selector) => 
      found || dialog.querySelector<HTMLElement>(selector), null);

    if (!editor) {
      console.error("[AutoPoster] Editor not found in dialog");
      return false;
    }

    // Insert content
    const trimmedContent = content.trim();
    if (/^https?:\/\/\S+$/.test(trimmedContent)) {
      insertUrlAsText(editor, trimmedContent);
    } else {
      insertTextIntoContentEditable(editor, content);
    }
    await delay(CONSTANTS.CLICK_DELAY);

    // Handle media uploads if present
    if (mediaUrls.length > 0) {
      const uploadSuccess = await uploadMedia(dialog, mediaUrls);
      if (!uploadSuccess) {
        console.warn("[AutoPoster] Media upload failed, continuing with text only");
      }
      // Wait for preview/upload processing
      await delay(CONSTANTS.CLICK_DELAY * 2);
    }

  // Enhanced post button detection with new scoring system
  interface ScoredButton {
    element: HTMLElement;
    score: number;
    type: 'post' | 'next' | 'unknown';
  }

  let postBtn: HTMLElement | undefined = undefined;
  const maxAttempts = 30;

  // Use the previously defined helper functions: normalizeText, isElementVisible, toHTMLElement
  
  function scoreButton(btn: HTMLElement): ScoredButton | null {
    // Use visibility helper function
    if (!isElementVisible(btn)) return null;

    const style = window.getComputedStyle(btn);

    // Extended disabled state checks
    const isDisabled = btn.getAttribute('aria-disabled') === 'true' || 
                      btn.classList.contains('disabled') ||
                      btn.hasAttribute('disabled') ||
                      style.opacity === '0.4' ||
                      style.cursor === 'not-allowed';
    if (isDisabled) return null;

    // Check for suspicious classes/attributes that might indicate non-interactive elements
    const suspiciousClasses = ['x1h6gzvc', 'x1lq5wgf', 'xgqcy7u', 'x30kzoy'];
    if (suspiciousClasses.some(c => btn.classList.contains(c))) return null;

    // Collect all text content
    const text = (btn.textContent || '').trim().toLowerCase();
    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
    const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
    const role = btn.getAttribute('role') || '';

    let score = 0;
    let type: 'post' | 'next' | 'unknown' = 'unknown';

    // Enhanced text scoring with more comprehensive matching
    if (text === 'đăng' || text === 'post') {
      score += 100;
      type = 'post';
    }
    if (text === 'tiếp' || text === 'next') {
      score += 80;
      type = 'next';
    }
    if (/^(đăng|post|share|chia sẻ|publish)$/.test(text)) {
      score += 90;
      type = 'post';
    }

    // Check aria labels
    if (ariaLabel.includes('đăng') || ariaLabel.includes('post')) {
      score += 60;
      if (type === 'unknown') type = 'post';
    }
    if (ariaLabel.includes('next') || ariaLabel.includes('tiếp')) {
      score += 50;
      if (type === 'unknown') type = 'next';
    }

    // Check data-testid
    if (testId.includes('post-button') || testId.includes('share-button')) {
      score += 40;
      if (type === 'unknown') type = 'post';
    }
    if (testId.includes('next-button')) {
      score += 30;
      if (type === 'unknown') type = 'next';
    }

    // Special Facebook elements
    const targetSpan = btn.querySelector('span.x1lliihq.x6ikm8r.x10wlt62.x1n2onr6.xlyipyv.xuxw1ft');
    if (targetSpan?.textContent?.trim() === 'Đăng') {
      score += 150;
      type = 'post';
    }

    // Facebook-specific classes
    const fbClasses = [
      'x1ja2u2z', 'xdj266r', 'x9f619', 'x1n2onr6', 
      'x78zum5', 'x2lah0s', 'xsqbvy7', 'xb9jzoj'
    ];
    const matchingClasses = fbClasses.filter(c => btn.classList.contains(c));
    if (matchingClasses.length >= 3) score += matchingClasses.length * 10;

    // Structure checks
    if (role === 'button') score += 30;
    if (btn.tagName === 'BUTTON') score += 20;
    if (btn.matches('[type="submit"]')) score += 40;

    // Penalize suspicious elements
    if (text.includes('cancel') || text.includes('hủy')) score -= 100;
    if (text.includes('close') || text.includes('đóng')) score -= 100;

    // Validate the final score
    if (score <= 0) return null;

    return {
      element: btn,
      score,
      type
    };
  }

  for (let attempt = 1; attempt <= maxAttempts && !postBtn; attempt++) {
    // Get all potential clickable elements
    const buttonSelectors = [
      // Standard buttons
      'button[type="submit"]',
      'div[role="button"]',
      '[role="button"]',
      // Facebook-specific selectors
      'div.x1ja2u2z span',
      'div.xdj266r span',
      'div.x9f619[role="none"]',
      'div.x1n2onr6[role="none"]',
      // Aria labeled buttons
      '[aria-label*="post" i]',
      '[aria-label*="đăng" i]',
      '[aria-label*="share" i]',
      // Common Facebook button classes
      'div.xjbqb8w',
      'div.x1i10hfl',
      'div.x1qjc9v5',
      // Specific spans
      'span.x1lliihq.x6ikm8r.x10wlt62.x1n2onr6.xlyipyv.xuxw1ft'
    ];

    const candidates = buttonSelectors.reduce<HTMLElement[]>((acc, selector) => {
      try {
        const elements = Array.from(dialog.querySelectorAll<HTMLElement>(selector));
        return acc.concat(elements);
      } catch (error) {
        console.warn("[AutoPoster] Invalid selector:", selector, error);
        return acc;
      }
    }, []);

    // Score and filter candidates
    const scoredButtons = candidates
      .map(btn => scoreButton(btn))
      .filter((btn): btn is ScoredButton => btn !== null)
      .sort((a, b) => b.score - a.score);

    // Handle button selection based on context
    if (scoredButtons.length > 0) {
        // First try direct text matching
        const nextSpan = findSpanByText(dialog, 'Tiếp');
        const postSpan = findSpanByText(dialog, 'Đăng');
        
        // Helper to safely get HTMLElement from Element
        const toHTMLElement = (el: Element | null): HTMLElement | null => 
          el instanceof HTMLElement ? el : null;
        
        // Then try scored buttons as fallback
        const nextElement = nextSpan && (
          toHTMLElement(nextSpan.closest('[role="button"]')) || 
          toHTMLElement(nextSpan.parentElement)
        );
        
        const postElement = postSpan && (
          toHTMLElement(postSpan.closest('[role="button"]')) || 
          toHTMLElement(postSpan.parentElement)
        );

        const nextButton = nextElement ? {
          element: nextElement,
          score: 100,
          type: 'next' as const,
          description: 'Next button'
        } : scoredButtons.find(b => b.type === 'next' && b.score >= 60);
                          
        const postButton = postElement ? {
          element: postElement,
          score: 100,
          type: 'post' as const,
          description: 'Post button'
        } : scoredButtons.find(b => b.type === 'post' && b.score >= 80);      if (nextButton?.element) {
        postBtn = nextButton.element;
        console.log("[AutoPoster] Found Next button:", {
          score: nextButton.score,
          text: postBtn?.textContent?.trim() || ''
        });
      } else if (postButton?.element) {
        postBtn = postButton.element;
        console.log("[AutoPoster] Found Post button:", {
          score: postButton.score,
          text: postBtn?.textContent?.trim() || ''
        });
      }

      if (postBtn) {
        // Additional validation of selected button
        const rect = postBtn.getBoundingClientRect();
        const isInViewport = rect.top >= 0 && rect.bottom <= window.innerHeight;
        
        if (!isInViewport) {
          console.log("[AutoPoster] Selected button not in viewport, scrolling...");
          postBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await delay(500);
        }

        break;
      }
    }

    // Debug logging
    if (attempt === 1 || attempt % 5 === 0) {
      console.log(`[AutoPoster] Attempt ${attempt}/${maxAttempts} - Button candidates:`,
        scoredButtons.map(b => ({
          text: b.element.textContent?.trim().slice(0, 30),
          score: b.score,
          type: b.type,
          aria: b.element.getAttribute('aria-label'),
          classes: Array.from(b.element.classList).join(' ').slice(0, 50)
        }))
      );
    }

    console.log(`[AutoPoster] Chưa thấy nút Đăng, thử lại (${attempt}/${maxAttempts})`);
    await delay(500);
  }

  if (!postBtn) {
    console.error("[AutoPoster] Không tìm thấy nút Đăng");
    const dumpButtons = Array.from(dialog.querySelectorAll("div[role='button'], button, [role='button']")) as HTMLElement[];
    console.log("[AutoPoster] Buttons dump:", dumpButtons.slice(0, 20).map((b) => ({
      text: (b.textContent || "").trim().slice(0, 30),
      aria: (b.getAttribute("aria-label") || "").toLowerCase(),
      testId: b.getAttribute("data-testid"),
      disabled: b.getAttribute("aria-disabled") || (b as HTMLButtonElement).disabled,
      visible: b.offsetParent !== null,
      classes: b.className,
      rect: b.getBoundingClientRect()
    })));
    return false;
  }

    // Enhanced click handling
  try {
    // Pre-click validation
    if (!postBtn.isConnected || !postBtn.offsetParent) {
      console.error("[AutoPoster] Button is detached or hidden");
      return false;
    }
    
    // Check if text content is appropriate
    const btnText = postBtn.textContent?.trim().toLowerCase() || '';
    if (btnText.includes('hủy') || btnText.includes('đóng')) {
      console.error("[AutoPoster] Found wrong button type:", btnText);
      return false;
    }
    
    // 1. Scroll button into view if needed
    const rect = postBtn.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      postBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(500);
    }    // Enhanced click handling for specific button structure
    let clicked = false;
    
    // Try different button target strategies in order of preference
    const clickTargets = [
      // 1. Exact text span
      postBtn.querySelector<HTMLElement>('span.x1lliihq.x6ikm8r.x10wlt62.x1n2onr6.xlyipyv.xuxw1ft'),
      
      // 2. Parent span
      toHTMLElement(postBtn.closest('span.x193iq5w.xeuugli.x13faqbe.x1vvkbs')),
      
      // 3. Button container
      toHTMLElement(postBtn.querySelector('div[role="none"]')),
      
      // 4. Main wrapper
      toHTMLElement(postBtn.closest('div.x1ja2u2z.x78zum5.x2lah0s.x1n2onr6')),
      
      // 5. Original target
      postBtn
    ];
    
    // Try each target until one succeeds
    for (const target of clickTargets.filter(Boolean)) {
      if (!isElementVisible(target!)) continue;
      
      try {
        target!.focus();
        await delay(CONSTANTS.CLICK_DELAY / 5);
        target!.click();
        clicked = true;
        console.log("[AutoPoster] Successfully clicked:", target!.tagName, target!.className);
        break;
      } catch (err) {
        console.warn("[AutoPoster] Click failed for target:", target!.tagName, err);
        continue;
      }
    }
    
    if (!clicked) {
      console.warn("[AutoPoster] All click attempts failed");
    }

    // Method 2: Simulated mouse events with precise targeting
    if (!clicked) {
      const rect = postBtn.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const events = [
        new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window, clientX: centerX, clientY: centerY }),
        new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: centerX, clientY: centerY }),
        new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: centerX, clientY: centerY }),
        new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: centerX, clientY: centerY })
      ];

      for (const event of events) {
        postBtn.dispatchEvent(event);
        await delay(50);
      }
      clicked = true;
    }

    // 4. Enhanced verification with dialog sequence handling
    let verifyAttempts = 20; // Increased attempts
    let inFirstDialog = true;
    let previousState = '';
    let lastClickTime = 0;
    let postButtonClickCount = 0;
    const MAX_POST_CLICKS = 3;
    const CLICK_COOLDOWN = 3000; // 3 seconds between clicks
    
    while (verifyAttempts > 0) {
      const currentDialog = document.querySelector('[role="dialog"]');
      if (!currentDialog) {
        console.log("[AutoPoster] Post completed - Dialog closed");
        return true;
      }

      // Enhanced dialog state detection with comprehensive checks
      const state = {
        hasNextButton: findSpanByText(document.body, 'Tiếp') !== null,
        hasPostButton: findSpanByText(document.body, 'Đăng') !== null,
        hasShareDialog: !!document.querySelector('div[aria-label="Cài đặt bài viết"]'),
        hasPostContainer: !!document.querySelector('div.x1ja2u2z.x78zum5.x2lah0s.x1n2onr6'),
        isProcessing: !!document.querySelector('[role="progressbar"], .x1jx94hy, .xh8yej3, .x1n2onr6'),
        hasOverlay: !!document.querySelector('.x1ey2m1c, .x9f619.x1n2onr6.x1ja2u2z, .x78zum5.xdt5ytf.x1n2onr6'),
        dialogText: currentDialog.textContent?.trim() || '',
        hasErrorMsg: !!document.querySelector('[aria-label*="error" i], [aria-label*="lỗi" i]'),
        hasSuccessMsg: !!document.querySelector('[aria-label*="thành công" i], [aria-label*="success" i]'),
        imageUploading: !!document.querySelector('div[aria-label*="Đang tải" i]'),
      };

      const currentState = JSON.stringify(state);
      if (currentState !== previousState) {
        console.log("[AutoPoster] Dialog state:", {
          ...state,
          timeSinceLastClick: Date.now() - lastClickTime,
          postButtonClicks: postButtonClickCount,
          remainingAttempts: verifyAttempts
        });
        previousState = currentState;
      }

      // If processing or overlay visible, wait
      if (state.isProcessing || state.hasOverlay) {
        const elapsedTime = (Date.now() - lastClickTime) / 1000;
        
        // If processing for too long, check for success indicators
        if (elapsedTime > 15) {
          // Check for common success indicators
          const possibleSuccess = 
            !document.querySelector('[role="dialog"]') || // Dialog closed
            !!document.querySelector('.x1i10hfl') || // Success notification
            document.querySelectorAll('[role="dialog"]').length === 0 || // All dialogs closed
            document.querySelector('div[aria-label="Bài viết của bạn đã được chia sẻ"]'); // Post success message
            
          if (possibleSuccess) {
            console.log("[AutoPoster] Post appears complete after timeout");
            return true;
          }
        }
        
        // If still in first dialog after too long, try to recover
        if (inFirstDialog && elapsedTime > 20) {
          console.log("[AutoPoster] First dialog stuck, attempting recovery");
          const nextButton = Array.from(document.querySelectorAll('[role="button"]'))
            .find(btn => btn.textContent?.trim() === 'Tiếp');
          if (nextButton) {
            (nextButton as HTMLElement).click();
            await delay(2000);
          }
        }
        
        // Log status and continue waiting
        console.log("[AutoPoster] Processing or overlay visible, waiting...", {
          elapsedTime,
          inFirstDialog,
          state
        });
        
        await delay(1000);
        continue;
      }

      // First dialog with Next button
      if (inFirstDialog && state.hasNextButton) {
        console.log("[AutoPoster] Found Next button in first dialog");
        const nextBtn = Array.from(document.querySelectorAll('[role="button"]')).find(btn => {
          const span = btn.querySelector('span');
          return span?.textContent?.trim() === 'Tiếp';
        });
        
        if (nextBtn) {
          console.log("[AutoPoster] Clicking Next button");
          (nextBtn as HTMLElement).click();
          inFirstDialog = false;
          lastClickTime = Date.now();
          await delay(2000);
          continue;
        }
      }

      // Second dialog with Post button
      if (!inFirstDialog && state.hasPostButton) {
        const timeSinceLastClick = Date.now() - lastClickTime;
        
        if (timeSinceLastClick < CLICK_COOLDOWN) {
          console.log("[AutoPoster] Waiting for click cooldown:", 
            Math.round((CLICK_COOLDOWN - timeSinceLastClick) / 1000) + "s remaining");
          await delay(500);
          continue;
        }

        if (postButtonClickCount >= MAX_POST_CLICKS) {
          console.warn("[AutoPoster] Max post button clicks reached");
          return true; // Assume success after max clicks
        }

        console.log("[AutoPoster] Finding final post button");
        // Try multiple button selection strategies
        const postBtn = 
          document.querySelector('div[role="button"] span[class*="x1lliihq"]:has-text("Đăng")') ||
          document.querySelector('div.x1ja2u2z span:has-text("Đăng")') ||
          Array.from(document.querySelectorAll('[role="button"]'))
            .find(btn => btn.textContent?.trim() === 'Đăng');

        if (postBtn) {
          console.log("[AutoPoster] Clicking final post button");
          const parent = postBtn.closest('[role="button"]') || postBtn.parentElement;
          if (parent instanceof HTMLElement) {
            parent.click();
            postButtonClickCount++;
            lastClickTime = Date.now();
            await delay(3000);
            continue;
          }
        }
      }

      // Success conditions
      if (!state.hasNextButton && !state.hasPostButton && !state.isProcessing) {
        console.log("[AutoPoster] Post completed - No more buttons and not processing");
        return true;
      }

      await delay(500);
      verifyAttempts--;
    }

    console.log("[AutoPoster] Post button clicked but dialog still present - may need manual verification");
    return true;

  } catch (err) {
    console.error("[AutoPoster] Error during post button click:", err);
    return false;
  }
}


})();
