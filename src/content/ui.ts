import { delay } from "./utils";

export function getCreatePostDialog(): HTMLElement | null {
  const dialogs = Array.from(document.querySelectorAll("[role='dialog']")) as HTMLElement[];
  for (const d of dialogs) {
    const txt = (d.textContent || "").toLowerCase();
    if (txt.includes("tạo bài viết") || txt.includes("create post") || txt.includes("đăng bài")) {
      return d;
    }
  }
  return dialogs[0] || null;
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



export async function openPostDialog(retries = 10): Promise<boolean> {
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
await delay(4000);
return true;
}


console.log(`[AutoPoster] Retry openPostDialog (${i+1}/${retries})...`);
await delay(4000);
}


console.error("[AutoPoster] Không tìm thấy nút 'Bạn đang nghĩ gì...' sau nhiều lần thử");
return false;
}


export async function waitForCreatePostDialog(timeout = 15000): Promise<HTMLElement | null> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const dialogs = Array.from(document.querySelectorAll<HTMLElement>("[role='dialog']"));

    for (const d of dialogs) {
      // tìm heading / span / div text
      const heading = d.querySelector("h2, span, div");
      const txt = (heading?.textContent || "").toLowerCase();

      if (
        txt.includes("tạo bài viết") ||
        txt.includes("create post") ||
        txt.includes("đăng bài") ||
        txt.includes("what's on your mind")
      ) {
        console.log("[AutoPoster] Tìm thấy dialog Tạo bài viết");
        return d;
      }
    }

    await delay(300);
  }

  console.warn("[AutoPoster] Không tìm thấy dialog Tạo bài viết sau timeout");
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
  