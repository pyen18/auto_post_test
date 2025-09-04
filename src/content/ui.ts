import { delay } from "./utils";

export function getCreatePostDialog(): HTMLElement | null {
  // Enhanced dialog detection with multiple strategies and scoring

  interface ComposerCandidate {
    element: HTMLElement;
    score: number;
  }

  function scoreElement(element: HTMLElement): number {
    let score = 0;
    const text = (element.textContent || "").toLowerCase();
    const ariaLabel = (element.getAttribute("aria-label") || "").toLowerCase();
    const testId = (element.getAttribute("data-testid") || "").toLowerCase();
    const role = element.getAttribute("role") || "";

    // Check visibility
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || !element.offsetParent) {
      return 0;
    }

    // Strong indicators
    if (text.includes("tạo bài viết")) score += 100;
    if (text.includes("create post")) score += 100;
    if (text.includes("what's on your mind")) score += 100;
    if (text.includes("bạn đang nghĩ gì")) score += 100;
    if (ariaLabel.includes("create post")) score += 80;
    if (testId === "creation-trigger") score += 80;
    if (testId === "composer-trigger") score += 80;

    // Medium indicators
    if (text.includes("đăng bài")) score += 60;
    if (text.includes("write") || text.includes("viết")) score += 60;
    if (ariaLabel.includes("write post") || ariaLabel.includes("viết bài")) score += 60;

    // Structure indicators
    if (role === "dialog") score += 40;
    const hasEditor = !!element.querySelector("[contenteditable='true']");
    if (hasEditor) score += 50;

    // Check for post button variations
    const postButtonSelectors = [
      "button[type='submit']",
      "[aria-label*='Post']",
      "[aria-label*='post']",
      "[aria-label*='Đăng']",
      "div[role='button'] span:has-text('Đăng')",
      "div.x1ja2u2z span:has-text('Đăng')"
    ];
    
    const hasPostButton = postButtonSelectors.some(sel => !!element.querySelector(sel));
    if (hasPostButton) score += 40;

    // Facebook-specific elements
    if (element.matches("[data-pagelet='FeedComposer']")) score += 30;
    if (element.querySelector("[data-lexical-editor='true']")) score += 30;

    // Location-based scoring
    if (element.closest("[role='main']")) score += 20;
    
    // Penalize elements that look wrong
    if (text.includes("marketplace") || text.includes("group") || text.includes("event")) {
      score -= 100;
    }

    return score;
  }

  // Get all potential composer elements
  const candidates: ComposerCandidate[] = [];

  // Strategy 1: Dialog-based composers
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>("[role='dialog']"));
  dialogs.forEach(dialog => {
    const score = scoreElement(dialog);
    if (score > 0) candidates.push({ element: dialog, score });
  });

  // Strategy 2: Feed composers
  const feedComposers = Array.from(document.querySelectorAll<HTMLElement>([
    "[role='main'] form[method='POST']",
    "[data-pagelet='FeedComposer']",
    "form[method='POST']",
    "[role='main'] [contenteditable='true']"
  ].join(",")));
  
  feedComposers.forEach(composer => {
    const score = scoreElement(composer);
    if (score > 0) candidates.push({ element: composer, score });
  });

  // Strategy 3: Direct editor containers
  const editors = Array.from(document.querySelectorAll<HTMLElement>("div[contenteditable='true'][data-lexical-editor='true']"));
  editors.forEach(editor => {
    const container = 
      editor.closest<HTMLElement>("[role='dialog']") || 
      editor.closest<HTMLElement>("[role='main']") ||
      editor.closest<HTMLElement>("[role='region']");
    
    if (container) {
      const score = scoreElement(container);
      if (score > 0) candidates.push({ element: container, score });
    }
  });

  // Log candidates for debugging
  console.log("[AutoPoster] Composer candidates:", candidates.map(c => ({
    text: c.element.textContent?.slice(0, 50),
    score: c.score,
    role: c.element.getAttribute("role"),
    hasEditor: !!c.element.querySelector("[contenteditable='true']"),
    hasPostBtn: !!c.element.querySelector("[aria-label*='Post'], [aria-label*='Đăng']")
  })));

  // Return the highest scoring candidate
  const bestCandidate = candidates.sort((a, b) => b.score - a.score)[0];
  if (bestCandidate && bestCandidate.score >= 50) {
    console.log("[AutoPoster] Selected composer with score:", bestCandidate.score);
    return bestCandidate.element;
  }

  return null;
}



export async function waitForDialogClose(target?: HTMLElement, timeout = 45000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const interval = setInterval(() => {
      // Nếu có target → chờ nó biến mất
      if (target && !document.contains(target)) {
        clearInterval(interval);
        resolve();
        return;
      }

      // Nếu không có target → chờ không còn dialog nào
      const dialog = document.querySelector("[role='dialog']");
      if (!dialog) {
        clearInterval(interval);
        resolve();
        return;
      }

      if (Date.now() - start > timeout) {
        clearInterval(interval);
        reject(new Error("Dialog did not close in time"));
      }
    }, 500);
  });
}



export async function openPostDialog(retries = 15): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    console.log("[AutoPoster] Looking for create post trigger...");

    // Enhanced set of selectors for Facebook's post triggers
    const selectors = [
      // Direct post trigger selectors
      "[data-testid='create-post']",
      "[data-testid='creation-trigger']",
      "[aria-label='Create post']",
      "[aria-label='Tạo bài viết']",
      "[aria-label*='write']",
      "[aria-label*='viết']",
      // Feed-based triggers
      "[role='region'] [contenteditable='true']",
      "[role='main'] [contenteditable='true']",
      // Secondary triggers
      "[data-testid='composer-trigger']",
      "[data-testid*='post']",
      "[data-testid*='composer']",
      "[role='button'][tabindex='0']",
      // Feed area triggers
      "div[role='main'] div[role='button']",
      "div.x1lliihq div[role='button']", // Facebook's feed composer class
      "div.xdj266r div[role='button']",  // Another Facebook composer class
      // Generic triggers
      "div[role='button']",
      "span[role='button']",
      "a[role='button']",
      "button[type='button']"
    ];

    let postTrigger: HTMLElement | null = null;

    // Helper function to check if element is likely a bad target
    const isBadTarget = (el: HTMLElement): boolean => {
      const text = (el.textContent || '').toLowerCase();
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      const href = (el as HTMLAnchorElement).href?.toLowerCase() || '';
      
      // Skip elements that look like they're for live video/events/etc
      const badPatterns = [
        'live', 'video', 'sự kiện', 'event', 'stream', 'story', 
        'photo', 'ảnh', 'hình', 'reel', 'marketplace', 'group', 
        'nhóm', 'chat', 'message', 'tin nhắn'
      ];

      // Skip elements that look like navigation or utility buttons
      const skipPatterns = [
        'menu', 'search', 'tìm', 'notification', 'thông báo',
        'profile', 'account', 'setting', 'cài đặt', 'help', 'trợ giúp'
      ];

      // Check if URL indicates wrong page/feature
      if (href && (
        href.includes('/live/') || 
        href.includes('/events/') || 
        href.includes('/marketplace/') ||
        href.includes('/groups/') ||
        href.includes('/photos/') ||
        href.includes('/videos/')
      )) {
        return true;
      }

      return badPatterns.some(pattern => 
        text.includes(pattern) || ariaLabel.includes(pattern)
      ) || skipPatterns.some(pattern =>
        text.includes(pattern) || ariaLabel.includes(pattern)
      );
    };


    // First try: Look for visible composer textbox and its container
    const directComposer = document.querySelector<HTMLElement>(
      "div[contenteditable='true'][data-lexical-editor='true']"
    );
    
    if (directComposer && directComposer.offsetParent !== null) {
      // Look for the nearest container in order of preference
      const container = 
        directComposer.closest<HTMLElement>("[role='dialog']") ||
        directComposer.closest<HTMLElement>("[role='main']") ||
        directComposer.closest<HTMLElement>("[role='region']");

      if (container) {
        const style = window.getComputedStyle(container);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          postTrigger = container;
        }
      }
    }

    // Second try: Look through all selectors
    if (!postTrigger) {
      for (const selector of selectors) {
        const elements = Array.from(document.querySelectorAll<HTMLElement>(selector))
          .filter(el => {
            // Enhanced visibility checks
            const style = window.getComputedStyle(el);
            const isVisible = el.offsetParent !== null && 
                            !el.closest("[aria-hidden='true']") &&
                            !el.closest("[style*='display: none']") &&
                            style.visibility !== 'hidden' &&
                            style.display !== 'none';
            
            const rect = el.getBoundingClientRect();
            const hasSize = rect.width > 0 && rect.height > 0;
            const isInViewport = rect.top >= 0 && 
                               rect.left >= 0 && 
                               rect.bottom <= window.innerHeight &&
                               rect.right <= window.innerWidth;
            
            // Enhanced interactivity checks
            const isEnabled = !el.getAttribute("aria-disabled") && 
                            !el.classList.contains("disabled") &&
                            !el.getAttribute("disabled") &&
                            style.pointerEvents !== 'none';
            
            // Enhanced text relevance check with score-based approach
            const text = (el.textContent || "").toLowerCase();
            const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();
            const dataTestId = (el.getAttribute("data-testid") || "").toLowerCase();

            // Filter out bad targets
            if (isBadTarget(el)) return false;

            // Score the element
            let score = 0;

            // Strong positive indicators
            if (text.includes('tạo bài viết') || ariaLabel.includes('tạo bài viết')) score += 100;
            if (text.includes('bạn đang nghĩ gì') || text.includes("what's on your mind")) score += 100;
            if (text.match(/\b(đăng bài|post)\b/)) score += 80;
            if (ariaLabel.match(/\b(đăng bài|post)\b/)) score += 80;

            // Good indicators
            if (text.includes('viết') || text.includes('write')) score += 40;
            if (dataTestId.includes('composer') || dataTestId.includes('create-post')) score += 50;
            
            // Location-based scoring
            const isInMainFeed = el.closest('[role="main"]') !== null;
            if (isInMainFeed) score += 30;

            // Element characteristics
            if (el.getAttribute('role') === 'textbox') score += 20;
            if (el.getAttribute('contenteditable') === 'true') score += 20;
            if (el.tagName === 'DIV' && el.getAttribute('role') === 'button') score += 10;

            const hasRelevantScore = score >= 50;
            return isVisible && hasSize && isEnabled && hasRelevantScore && isInViewport;
          });

        // Take the first matching element
        if (elements.length > 0) {
          postTrigger = elements[0];
          break;
        }
      }
    }

    // If no trigger found, try a broader search
    if (!postTrigger) {
      const allCandidates = Array.from(document.querySelectorAll<HTMLElement>(
        "div[role='button'], button, a[role='button'], [data-testid*='post'], [data-testid*='composer']"
      ));

      postTrigger = allCandidates.find(el => {
        const text = (el.textContent || "").toLowerCase();
        const aria = (el.getAttribute("aria-label") || "").toLowerCase();
        
        const relevantText = 
          text.includes("tạo bài viết") ||
          text.includes("create post") ||
          text.includes("write something") ||
          text.includes("what's on your mind") ||
          text.includes("bạn đang nghĩ gì") ||
          aria.includes("create") ||
          aria.includes("post") ||
          aria.includes("tạo") ||
          aria.includes("viết");

        return (
          el.offsetParent !== null && // Visible
          !el.getAttribute("aria-disabled") && // Not disabled
          relevantText
        );
      }) || null;
    }

    if (postTrigger) {
      console.log("[AutoPoster] Found post trigger:", {
        element: postTrigger.tagName,
        text: postTrigger.textContent?.trim().slice(0, 50),
        aria: postTrigger.getAttribute("aria-label"),
        testId: postTrigger.getAttribute("data-testid"),
        role: postTrigger.getAttribute("role")
      });

      // Enhanced click method with multiple fallbacks
      try {
        // Validate the element one last time before clicking
        if (isBadTarget(postTrigger)) {
          console.warn("[AutoPoster] Prevented click on potentially bad target", {
            text: postTrigger.textContent?.trim(),
            ariaLabel: postTrigger.getAttribute("aria-label"),
            href: (postTrigger as HTMLAnchorElement).href
          });
          return false;
        }

        // Store the initial URL
        const initialUrl = window.location.href;

        // 1. Ensure element is in view
        const scrollBehavior = { behavior: 'smooth' as ScrollBehavior, block: 'center' as ScrollLogicalPosition };
        postTrigger.scrollIntoView(scrollBehavior);
        await delay(1000); // Wait for scroll animation

        // Function to check if dialog or composer is open
        const isComposerOpen = () => {
          const dialog = document.querySelector('[role="dialog"]');
          const composer = document.querySelector('div[contenteditable="true"][data-lexical-editor="true"]');
          
          // Validate the dialog is actually a post dialog
          if (dialog) {
            const text = dialog.textContent?.toLowerCase() || '';
            return text.includes('tạo bài viết') || 
                   text.includes('create post') ||
                   text.includes('bạn đang nghĩ gì');
          }
          
          return !!composer;
        };

        // Function to check if we navigated away
        const hasNavigatedAway = () => {
          return window.location.href !== initialUrl ||
                 window.location.href.includes('/live/') ||
                 window.location.href.includes('/events/');
        };

        // 2. First attempt: Native click with focus and hover simulation
        postTrigger.focus();
        await delay(100);
        
        // Simulate hover first
        postTrigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await delay(100);
        
        postTrigger.click();
        await delay(1000);

        // Check if we navigated to a wrong page
        if (hasNavigatedAway()) {
          console.warn("[AutoPoster] Click caused navigation, reverting...");
          window.history.back();
          return false;
        }

        // 3. If no dialog/composer, try enhanced click simulation
        if (!isComposerOpen()) {
          const rect = postTrigger.getBoundingClientRect();
          const centerX = Math.floor(rect.left + rect.width / 2);
          const centerY = Math.floor(rect.top + rect.height / 2);

          // Common event properties
          const eventInit: MouseEventInit = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: centerX,
            clientY: centerY,
            screenX: centerX,
            screenY: centerY,
            buttons: 1,
            detail: 1
          };

          // Create and dispatch events in sequence
          const events: Event[] = [
            new MouseEvent('mouseenter', eventInit),
            new MouseEvent('mouseover', eventInit),
            new FocusEvent('focusin', { bubbles: true }),
            new MouseEvent('mousedown', eventInit),
            new MouseEvent('mouseup', eventInit),
            new MouseEvent('click', eventInit)
          ];

          // Dispatch events with natural timing
          for (const event of events) {
            postTrigger.dispatchEvent(event);
            await delay(50);
          }

          await delay(500);
        }

        // 4. If still no dialog, try alternative click targets
        if (!isComposerOpen()) {
          // Try clicking any nested buttons or interactive elements
          const clickTargets = Array.from(postTrigger.querySelectorAll<HTMLElement>(
            'button, [role="button"], [tabindex="0"], [contenteditable="true"]'
          )).filter(el => {
            const style = window.getComputedStyle(el);
            return el.offsetParent !== null && 
                   style.display !== 'none' && 
                   style.visibility !== 'hidden';
          });

          for (const target of clickTargets) {
            target.click();
            await delay(500);
            if (isComposerOpen()) break;
          }
        }

        console.log("[AutoPoster] Clicked create post trigger with enhanced method");

        // Wait for dialog/composer to appear with multiple checks
        let dialogFound = false;
        const maxWait = 10;
        for (let j = 0; j < maxWait && !dialogFound; j++) {
          await delay(1000);
          
          // Check for dialog
          const dialog = document.querySelector("[role='dialog']");
          const composer = document.querySelector("[contenteditable='true']");
          
          if (dialog || composer) {
            console.log("[AutoPoster] Post dialog/composer found after", j + 1, "seconds");
            dialogFound = true;
            break;
          }
          
          // If still not found, try clicking again on retry 5
          if (j === 5) {
            console.log("[AutoPoster] Re-attempting click...");
            postTrigger.click();
          }
        }

        return dialogFound;
      } catch (err) {
        console.error("[AutoPoster] Error clicking post trigger:", err);
      }
    }

    console.log(`[AutoPoster] Retry ${i + 1}/${retries}...`);
    await delay(2000);
  }

  console.error("[AutoPoster] Failed to find or click post trigger");
  return false;
}


export async function waitForCreatePostDialog(timeout = 20000): Promise<HTMLElement | null> {
  const start = Date.now();
  
  // Pre-validate the URL to ensure we're on a valid page
  if (window.location.href.includes('/live/') || 
      window.location.href.includes('/events/') ||
      window.location.href.includes('/marketplace/')) {
    console.warn("[AutoPoster] Invalid Facebook page for posting");
    return null;
  }

  async function findComposer(): Promise<HTMLElement | null> {
    // Try multiple strategies to find the composer
    const strategies = [
      // Strategy 1: Dialog with create post content
      () => {
        // Check for the main composer form first
        const composerForm = document.querySelector('form[method="POST"]');
        if (composerForm) {
          const editable = composerForm.querySelector('[contenteditable="true"]');
          if (editable && (editable as HTMLElement).offsetParent !== null) {
            return composerForm as HTMLElement;
          }
        }

        // Then check dialogs
        const dialogs = Array.from(document.querySelectorAll<HTMLElement>("[role='dialog']"));
        for (const dialog of dialogs) {
          const text = dialog.textContent?.toLowerCase() || "";
          // Check for the dialog content and ensure it has an editable area
          if ((text.includes("tạo bài viết") || 
               text.includes("create post") || 
               text.includes("write something") || 
               text.includes("what's on your mind") ||
               text.includes("bạn đang nghĩ gì")) &&
              dialog.querySelector('[contenteditable="true"]')) {
            return dialog;
          }
        }

        // Look for the feed composer
        const feedComposer = document.querySelector('[role="main"] [contenteditable="true"]')?.closest('[role="main"]');
        if (feedComposer) return feedComposer as HTMLElement;

        return null;
      },
      
      // Strategy 2: Direct composer element
      () => {
        const selectors = [
          "[data-testid='creation-trigger']",
          "[data-testid='composer']",
          "[aria-label*='create']",
          "[aria-label*='post']",
          "[aria-label*='tạo']",
          "[aria-label*='viết']",
          "div[role='textbox'][contenteditable='true']",
          "div[data-contents='true']"
        ];
        
        for (const selector of selectors) {
          const el = document.querySelector<HTMLElement>(selector);
          if (el && el.offsetParent !== null) return el;
        }
        return null;
      },
      
      // Strategy 3: Look for the contenteditable area
      () => {
        const editables = Array.from(document.querySelectorAll<HTMLElement>("div[contenteditable='true']"));
        for (const editable of editables) {
          if (editable.offsetParent !== null && 
              !editable.closest("[aria-hidden='true']") &&
              (editable.getAttribute("data-lexical-editor") === "true" ||
               editable.getAttribute("role") === "textbox")) {
            const container = editable.closest("[role='dialog']") || editable.closest("[role='main']");
            return container as HTMLElement || editable;
          }
        }
        return null;
      },
      
      // Strategy 4: Look for specific Facebook composer elements
      () => {
        const fbSpecificSelectors = [
          "[data-pagelet='FeedComposer']",
          "form[method='POST']",
          "[role='main'] div[role='button']",
          "div.xdj266r", // Facebook's composer class
          "div.x1lliihq" // Another Facebook composer class
        ];
        
        for (const selector of fbSpecificSelectors) {
          const el = document.querySelector<HTMLElement>(selector);
          if (el && el.offsetParent !== null) {
            // Verify it's a composer by checking for typical child elements
            const hasTextbox = el.querySelector("[contenteditable='true']") !== null;
            const hasPostButton = el.querySelector("button[type='submit']") !== null;
            if (hasTextbox || hasPostButton) return el;
          }
        }
        return null;
      }
    ];

    // Try each strategy
    for (const strategy of strategies) {
      const result = strategy();
      if (result) {
        console.log("[AutoPoster] Found composer using strategy:", strategy.name);
        return result;
      }
    }
    
    return null;
  }

  while (Date.now() - start < timeout) {
    const composer = await findComposer();
    if (composer) {
      console.log("[AutoPoster] Found post composer:", {
        tagName: composer.tagName,
        role: composer.getAttribute("role"),
        dataTestId: composer.getAttribute("data-testid"),
        hasTextbox: !!composer.querySelector("[contenteditable='true']"),
        hasPostButton: !!composer.querySelector("button[type='submit']"),
        rect: composer.getBoundingClientRect()
      });
      return composer;
    }

    // Log diagnostic info periodically
    if (((Date.now() - start) % 2000) < 300) {
      console.log("[AutoPoster][waitForCreatePostDialog] Scanning...", {
        timeElapsed: Math.round((Date.now() - start) / 1000) + "s",
        url: location.href,
        readyState: document.readyState,
        dialogCount: document.querySelectorAll("[role='dialog']").length,
        editableCount: document.querySelectorAll("[contenteditable='true']").length
      });
    }

    await delay(300);
  }

  console.warn("[AutoPoster] Could not find post composer after timeout");
  return null;
}



export async function insertTextIntoContentEditable(
  editor: HTMLElement,
  text: string,
): Promise<boolean> {
  try {
    // Clear content trước khi insert
    editor.innerHTML = "";
    editor.textContent = "";

    // Focus vào editor
    editor.focus();
    await delay(100);

    // Thay vì execCommand, set trực tiếp
    editor.textContent = text;

    // Trigger input event để FB cập nhật state
    editor.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text,
      })
    );

    // Đặt cursor ở cuối
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(editor);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);

    console.log("[AutoPoster] Text inserted successfully:", text.substring(0, 50));
    return true;
  } catch (err) {
    console.error("[AutoPoster] insertTextIntoContentEditable error:", err);
    return false;
  }
}
