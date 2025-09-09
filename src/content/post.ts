
import { delay } from './utils';
import { waitForCreatePostDialog, insertTextIntoContentEditable } from './ui';

// Types and Interfaces
interface ImageValidationOptions {
  minWidth?: number;
  minHeight?: number;
}

interface DownloadResponse {
  ok: boolean;
  bufferBase64?: string;
  name: string;
  mime: string;
  error?: string;
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

/**
 * Enhanced function to reliably click the "Đăng" (Post) button
 * Uses MutationObserver, retry mechanism, and safe selectors
 */
export async function clickPostButton(container: HTMLElement = document.body): Promise<boolean> {
  console.log("[AutoPoster] Starting enhanced post button click sequence");
  
  const MAX_RETRIES = 5;
  const RETRY_DELAY = 1000;
  const MUTATION_TIMEOUT = 10000;
  
  // Safe selector function using role and text content
  function findPostButton(): HTMLElement | null {
    // Strategy 1: Find by role=button and exact text "Đăng"
    const buttons = Array.from(container.querySelectorAll<HTMLElement>('[role="button"]'));
    
    for (const button of buttons) {
      if (!isElementVisible(button)) continue;
      
      // Check if button or its children contain "Đăng" text
      const buttonText = button.textContent?.trim();
      const spans = button.querySelectorAll('span');
      
      // Check button text directly
      if (buttonText === 'Đăng') {
        return button;
      }
      
      // Check spans within button
      for (const span of spans) {
        if (span.textContent?.trim() === 'Đăng') {
          return button;
        }
      }
      
      // Check aria-label for Vietnamese and English
      const ariaLabel = button.getAttribute('aria-label');
      if (ariaLabel && (ariaLabel.includes('Đăng') || ariaLabel.toLowerCase().includes('post'))) {
        return button;
      }
    }
    
    // Strategy 2: Look for submit buttons in forms
    const submitButtons = Array.from(container.querySelectorAll<HTMLElement>('button[type="submit"]'));
    for (const button of submitButtons) {
      if (isElementVisible(button) && button.textContent?.trim() === 'Đăng') {
        return button;
      }
    }
    
    // Strategy 3: Look for buttons with specific Facebook classes and "Đăng" text
    const fbButtons = Array.from(container.querySelectorAll<HTMLElement>('div[class*="x1i10hfl"], div[class*="xjbqb8w"]'));
    for (const button of fbButtons) {
      if (isElementVisible(button) && button.getAttribute('role') === 'button') {
        const buttonText = button.textContent?.trim();
        if (buttonText === 'Đăng') {
          return button;
        }
      }
    }
    
    return null;
  }
  
  // Wait for button to be present and enabled using MutationObserver
  function waitForPostButton(): Promise<HTMLElement> {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line prefer-const
      let observer: MutationObserver;
      
      const timeout = setTimeout(() => {
        if (observer) observer.disconnect();
        reject(new Error('Post button not found within timeout'));
      }, MUTATION_TIMEOUT);
      
      const checkButton = () => {
        const button = findPostButton();
        if (button) {
          // Check if button is enabled
          const isDisabled = button.getAttribute('aria-disabled') === 'true' ||
                           button.hasAttribute('disabled') ||
                           button.classList.contains('disabled');
          
          if (!isDisabled) {
            clearTimeout(timeout);
            if (observer) observer.disconnect();
            console.log("[AutoPoster] Post button found and enabled");
            resolve(button);
            return true;
          }
        }
        return false;
      };
      
      // Check immediately
      if (checkButton()) return;
      
      // Set up MutationObserver to watch for changes
      observer = new MutationObserver(() => {
        checkButton();
      });
      
      observer.observe(container, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-disabled', 'disabled', 'class']
      });
    });
  }
  
  // Enhanced click function with multiple strategies
  async function performClick(button: HTMLElement, retryCount: number): Promise<boolean> {
    try {
      console.log(`[AutoPoster] Attempting to click post button (attempt ${retryCount + 1})`);
      
      // Step 1: Focus the button
      button.focus();
      await delay(100);
      
      // Step 2: Scroll into view
      button.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(300);
      
      // Step 3: Verify button is still visible and enabled
      if (!isElementVisible(button)) {
        console.warn("[AutoPoster] Button became invisible after scroll");
        return false;
      }
      
      const isDisabled = button.getAttribute('aria-disabled') === 'true' ||
                        button.hasAttribute('disabled') ||
                        button.classList.contains('disabled');
      
      if (isDisabled) {
        console.warn("[AutoPoster] Button is disabled");
        return false;
      }
      
      // Step 4: Multiple click strategies with improved success detection
      const clickStrategies = [
        // Strategy 1: Direct click
        () => {
          button.click();
        },
        
        // Strategy 2: Click on span child if exists
        () => {
          const span = button.querySelector('span');
          if (span && span.textContent?.trim() === 'Đăng') {
            (span as HTMLElement).click();
          } else {
            throw new Error('No valid span found');
          }
        },
        
        // Strategy 3: Simulated mouse events
        () => {
          const rect = button.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          
          const mouseEvents = [
            new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: centerX, clientY: centerY }),
            new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: centerX, clientY: centerY }),
            new MouseEvent('click', { bubbles: true, cancelable: true, clientX: centerX, clientY: centerY })
          ];
          
          mouseEvents.forEach(event => button.dispatchEvent(event));
        },
        
        // Strategy 4: Keyboard activation
        () => {
          button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          button.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
        }
      ];
      
      // Try each strategy with improved success detection
      for (let i = 0; i < clickStrategies.length; i++) {
        try {
          console.log(`[AutoPoster] Trying click strategy ${i + 1}`);
          clickStrategies[i]();
          
          // Wait for potential DOM changes
          await delay(800);
          
          // Multiple success indicators
          const successChecks = [
            // Check 1: Dialog closed completely
            () => !document.querySelector('[role="dialog"]'),
            
            // Check 2: Post button disappeared
            () => !findPostButton(),
            
            // Check 3: Success message or redirect
            () => document.querySelector('[data-testid="post-success"]') || 
                  window.location.href.includes('/posts/') ||
                  document.querySelector('.success, .posted'),
            
            // Check 4: Button state changed to loading or disabled
            () => {
              const currentButton = findPostButton();
              return currentButton && (
                currentButton.getAttribute('aria-disabled') === 'true' ||
                currentButton.classList.contains('loading') ||
                currentButton.querySelector('.loading, .spinner')
              );
            }
          ];
          
          // Check if any success indicator is true
          const isSuccessful = successChecks.some(check => {
            try {
              return check();
            } catch {
              return false;
            }
          });
          
          if (isSuccessful) {
            console.log(`[AutoPoster] Click strategy ${i + 1} successful`);
            return true;
          }
          
        } catch (error) {
          console.warn(`[AutoPoster] Click strategy ${i + 1} failed:`, error);
          continue;
        }
      }
      
      return false;
      
    } catch (error) {
      console.error("[AutoPoster] Error during click attempt:", error);
      return false;
    }
  }
  
  // Main retry loop
  for (let retryCount = 0; retryCount < MAX_RETRIES; retryCount++) {
    try {
      console.log(`[AutoPoster] Post button click attempt ${retryCount + 1}/${MAX_RETRIES}`);
      
      // Wait for button to be available
      const button = await waitForPostButton();
      console.log("[AutoPoster] Post button detected:", {
        text: button.textContent?.trim(),
        ariaLabel: button.getAttribute('aria-label'),
        tagName: button.tagName,
        classes: button.className.slice(0, 100)
      });
      
      // Attempt to click
      const clickSuccess = await performClick(button, retryCount);
      
      if (clickSuccess) {
        console.log("[AutoPoster] Post button clicked successfully");
        return true;
      }
      
      // If not successful and not the last retry, wait before trying again
      if (retryCount < MAX_RETRIES - 1) {
        console.log(`[AutoPoster] Click failed, retrying in ${RETRY_DELAY}ms...`);
        await delay(RETRY_DELAY);
      }
      
    } catch (error) {
      console.error(`[AutoPoster] Retry ${retryCount + 1} failed:`, error);
      
      if (retryCount < MAX_RETRIES - 1) {
        await delay(RETRY_DELAY);
      }
    }
  }
  
  console.error("[AutoPoster] Failed to click post button after all retries");
  return false;
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
    console.log('[content] Requesting media download for:', url);
    
    const response = await new Promise<DownloadResponse>((resolve) => {
      chrome.runtime.sendMessage({ type: 'DOWNLOAD_MEDIA', url }, resolve);
    });

    if (!response?.ok || !response.bufferBase64) {
      console.warn('[content] Media download failed:', url, response?.error);
      return null;
    }

    // Convert base64 to Blob
    const bytes = Uint8Array.from(atob(response.bufferBase64), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: response.mime || 'application/octet-stream' });
    
    console.log('[content] Media download successful:', {
      url,
      name: response.name,
      mime: response.mime,
      size: blob.size
    });
    
    return blob;
  } catch (error) {
    console.error('[content] Media download error:', url, error);
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

export async function postContentToFacebook(content: string, mediaUrls: string[] = []): Promise<boolean> {
  try {
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

    // Handle "Next" button first if present
    const nextSpan = findSpanByText(dialog, 'Tiếp');
    if (nextSpan) {
      const nextButton = nextSpan.closest('[role="button"]') as HTMLElement || nextSpan.parentElement as HTMLElement;
      if (nextButton && isElementVisible(nextButton)) {
        console.log("[AutoPoster] Found Next button, clicking...");
        nextButton.focus();
        nextButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await delay(300);
        nextButton.click();
        await delay(2000); // Wait for dialog transition
      }
    }

    // Now handle the final "Đăng" (Post) button using the enhanced function
    console.log("[AutoPoster] Looking for final post button...");
    const postSuccess = await clickPostButton(dialog);
    
    if (!postSuccess) {
      console.error("[AutoPoster] Failed to click post button after all attempts");
      return false;
    }

    console.log("[AutoPoster] Post submitted successfully");
    return true;

  } catch (err) {
    console.error("[AutoPoster] Error during posting:", err);
    return false;
  }
}
