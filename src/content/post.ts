
import { delay } from "./utils";
import { waitForCreatePostDialog, insertTextIntoContentEditable } from "./ui";
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

  try {
   
    const success = document.execCommand("insertText", false, url);
    if (!success) {
      const textNode = document.createTextNode(url);
      editor.appendChild(textNode);
      editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
    } else {
      editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (err) {
    const textNode = document.createTextNode(url);
    editor.appendChild(textNode);
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }
}
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

// Wrap the implementation in an IIFE to prevent global variable conflicts
export const postContentToFacebook = (() => {
  // Internal module state// 5 seconds between attempts
  
  return async function(content: string, mediaUrls: string[] = []): Promise<boolean> {
  console.log("[AutoPoster] Waiting for Create Post dialog...", {
    now: new Date().toISOString(),
    url: location.href,
    contentPreview: (content || "").slice(0, 80),
    mediaCount: mediaUrls?.length || 0,
  });
  const dialog = await waitForCreatePostDialog(20000);
  if (!dialog) {
    // Enhanced diagnostics to help debug why dialog not found
    const allDialogs = Array.from(document.querySelectorAll<HTMLElement>("[role='dialog']"));
    const allComposers = Array.from(document.querySelectorAll<HTMLElement>("[data-pagelet*='Composer'], [data-testid*='composer'], [data-testid*='post']"));
    const allContentEditable = Array.from(document.querySelectorAll<HTMLElement>("[contenteditable='true']"));
    
    console.warn("[AutoPoster][postContentToFacebook] No dialog after wait. Enhanced diagnostics:", {
      url: location.href,
      dialogs: allDialogs.length,
      composers: allComposers.length,
      contentEditable: allContentEditable.length,
      dialogDetails: allDialogs.map((d, i) => ({
        index: i,
        text: (d.textContent || "").trim().slice(0, 100),
        ariaLabel: d.getAttribute("aria-label") || "",
        dataTestId: d.getAttribute("data-testid") || "",
        visible: d.offsetParent !== null,
        classes: d.className.slice(0, 100)
      })),
      composerDetails: allComposers.map((c, i) => ({
        index: i,
        text: (c.textContent || "").trim().slice(0, 100),
        dataPagelet: c.getAttribute("data-pagelet") || "",
        dataTestId: c.getAttribute("data-testid") || "",
        visible: c.offsetParent !== null
      })),
      bodyHasComposer: !!document.querySelector("[data-pagelet*='FeedComposer']"),
      readyState: document.readyState,
      visibility: document.visibilityState
    });
    return false;
  }

  // Tìm editor (supports dialog or inline composer)
  const editorSelectors = [
    "div[role='textbox'][contenteditable='true']",
    "div[contenteditable='true'][data-lexical-editor='true']",
    "div[contenteditable='true'][data-text='true']",
    "div[contenteditable='true']",
    "[contenteditable='true']",
  ];
  let editor: HTMLElement | null = null;
  for (const sel of editorSelectors) {
    const found = dialog.querySelector(sel) as HTMLElement | null;
    if (found) { editor = found; break; }
  }
  if (!editor) {
    console.error("[AutoPoster] Không tìm thấy editor trong dialog");
    const debug = Array.from(dialog.querySelectorAll("[contenteditable]")) as HTMLElement[];
    console.log("[AutoPoster] contenteditable candidates:", debug.map((e) => ({
      tag: e.tagName,
      role: e.getAttribute("role"),
      dataLexical: e.getAttribute("data-lexical-editor"),
      visible: e.offsetParent !== null,
      text: (e.textContent || "").trim().slice(0, 40),
    })));
    return false;
  }

  // Nếu content là URL -> paste, nếu không thì insert text
  const isUrl = /^https?:\/\/\S+$/.test(content.trim());
  if (isUrl) {
    insertUrlAsText(editor, content.trim());
  } else {
    insertTextIntoContentEditable(editor, content);
  }

  // Upload media (một lần, không lặp thừa)
  if (mediaUrls && mediaUrls.length > 0) {
    console.log("[AutoPoster] Bắt đầu upload media:", mediaUrls.length);
    const ok = await uploadMedia(dialog, mediaUrls);
    if (!ok) {
      console.warn("[AutoPoster] Upload media thất bại, tiếp tục đăng chỉ văn bản");
    } else {
      await delay(1500);
    }
  }

  await delay(2000); // đợi preview hiện

  // Enhanced post button detection with new scoring system
  interface ScoredButton {
    element: HTMLElement;
    score: number;
    type: 'post' | 'next' | 'unknown';
  }

  let postBtn: HTMLElement | undefined = undefined;
  const maxAttempts = 30;

  function findSpanByText(container: HTMLElement, text: string): HTMLElement | null {
    // Enhanced text matching with fuzzy matching for special characters
    const normalizeText = (str: string) => str.trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    
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

  function scoreButton(btn: HTMLElement): ScoredButton | null {
    // Enhanced visibility and state validation
    if (!btn.isConnected || !btn.offsetParent || btn.offsetWidth === 0 || btn.offsetHeight === 0) return null;

    const style = window.getComputedStyle(btn);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return null;

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
        const nextButton = nextSpan ? { 
          element: toHTMLElement(nextSpan.closest('[role="button"]')) || 
                  toHTMLElement(nextSpan.parentElement), 
          score: 100, 
          type: 'next' as const
        } : scoredButtons.find(b => b.type === 'next' && b.score >= 60);
                          
        const postButton = postSpan ? { 
          element: toHTMLElement(postSpan.closest('[role="button"]')) || 
                  toHTMLElement(postSpan.parentElement), 
          score: 100, 
          type: 'post' as const
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
    }    // 2. Enhanced click handling for specific button structure
    let actualClickTarget = postBtn;
    
    // If we found the outer container, look for the clickable inner element
    if (postBtn.matches('div.x1ja2u2z')) {
      const innerButton = postBtn.querySelector('div[role="none"]') as HTMLElement;
      if (innerButton) {
        actualClickTarget = innerButton;
      }
    }
    
    // Focus the actual target
    try {
      actualClickTarget.focus();
    } catch (err) {
      console.warn("[AutoPoster] Focus failed, continuing...", err);
    }
    await delay(100);

    // 3. Try multiple click methods with enhanced targeting
    let clicked = false;

    // Method 1: Enhanced hierarchical click handling with precise targeting
    try {
      let clicked = false;
      
      // 1. Try clicking the exact text span first
      const textSpan = actualClickTarget.querySelector('span.x1lliihq.x6ikm8r.x10wlt62.x1n2onr6.xlyipyv.xuxw1ft');
      if (textSpan) {
        console.log("[AutoPoster] Found and clicking text span");
        const spanEl = textSpan as HTMLElement;
        spanEl.focus();
        await delay(100);
        spanEl.click();
        clicked = true;
      }
      
      // 2. Try the immediate parent span if direct span click didn't work
      if (!clicked) {
        const parentSpan = textSpan?.parentElement;
        if (parentSpan && parentSpan.matches('span.x193iq5w.xeuugli.x13faqbe.x1vvkbs.x1xmvt09.x1lliihq.x1s928wv.xhkezso.x1gmr53x.x1cpjm7i.x1fgarty.x1943h6x.xudqn12.x3x7a5m.x6prxxf.xvq8zen.x1s688f.xtk6v10')) {
          console.log("[AutoPoster] Clicking parent span");
          const el = parentSpan as HTMLElement;
          el.focus();
          await delay(100);
          el.click();
          clicked = true;
        }
      }
      
      // 3. Try the button container with role="none"
      if (!clicked) {
        const buttonContainer = actualClickTarget.querySelector('div.x9f619.x1n2onr6.x1ja2u2z.x193iq5w.xeuugli.x6s0dn4.x78zum5.x2lah0s.xsqbvy7.xb9jzoj[role="none"]');
        if (buttonContainer) {
          console.log("[AutoPoster] Clicking button container");
          const el = buttonContainer as HTMLElement;
          el.focus();
          await delay(100);
          el.click();
          clicked = true;
        }
      }
      
      // 4. Try clicking the main wrapper as a fallback
      if (!clicked) {
        const mainWrapper = actualClickTarget.closest('div.x1ja2u2z.x78zum5.x2lah0s.x1n2onr6.xl56j7k');
        if (mainWrapper) {
          console.log("[AutoPoster] Clicking main wrapper");
          const el = mainWrapper as HTMLElement;
          el.focus();
          await delay(100);
          el.click();
          clicked = true;
        }
      }

      // 5. Try direct click as last resort
      if (!clicked) {
        console.log("[AutoPoster] Direct click on target");
        actualClickTarget.focus();
        await delay(100);
        actualClickTarget.click();
        clicked = true;
      }

      if (!clicked) {
        throw new Error("No clickable element found");
      }
    } catch (err) {
      console.warn("[AutoPoster] Click sequence failed:", err);
      clicked = false;
    }

    // Method 2: Simulated mouse events with precise targeting
    if (!clicked) {
      const rect = actualClickTarget.getBoundingClientRect();
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
