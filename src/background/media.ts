// Types
interface MediaFetchResult {
  ok: boolean;
  name: string;
  mime: string;
  bufferBase64?: string;
  size?: number;
  originalUrl: string;
  error?: string;
}

interface MimeExtensionMap {
  [mime: string]: string;
}

// --- Helper functions ---------------------Media helpers-----
// convert ArrayBuffer to Base64
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

// suy đoán mime và đảm bảo đuôi file hợp lệ.
export function guessMimeFromExt(urlPath: string): string {
  const lower = urlPath.toLowerCase();
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

export function ensureExtByMime(name: string, mime: string): string {
  const map: MimeExtensionMap = {
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
  const wantedExt = map[(mime || "").toLowerCase()];
  if (!wantedExt) return name;
  const lower = name.toLowerCase();
  const hasKnownExt = Object.values(map).some((ext) => lower.endsWith(ext));
  return hasKnownExt ? name : name + wantedExt;
}

//fetch cross-origin (thêm UA, Accept, Referer tùy host), timeout 45s, trả {ok, name, mime, bufferBase64, size} để content script tạo File upload.
// Fixed media fetch function
export async function fetchMediaFromUrl(url: string): Promise<MediaFetchResult> {
  console.log("[Background] Starting fetchMediaFromUrl:", url);
  try {
    let cleanUrl = (url || "").trim();
    if (!cleanUrl) throw new Error("Invalid URL");

    if (
      (cleanUrl.startsWith('"') && cleanUrl.endsWith('"')) ||
      (cleanUrl.startsWith("'") && cleanUrl.endsWith("'"))
    )
      cleanUrl = cleanUrl.slice(1, -1);

    const urlObj = new URL(cleanUrl);
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "image/webp,image/apng,image/*,*/*;q=0.8,video/*",
      "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    };

    const hostname = urlObj.hostname.toLowerCase();
    if (hostname.includes("github")) headers["Referer"] = "https://github.com/";
    else if (hostname.includes("imgur"))
      headers["Referer"] = "https://imgur.com/";
    else if (hostname.includes("dropbox"))
      headers["Referer"] = "https://www.dropbox.com/";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    const response = await fetch(cleanUrl, {
      method: "GET",
      headers,
      signal: controller.signal,
      // In MV3 + host_permissions, the extension context can read cross-origin.
      // Keep mode default; forcing "no-cors" would make it opaque (unreadable).
      redirect: "follow",
      credentials: "omit",
    });

    clearTimeout(timeoutId);
    if (!response.ok)
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength === 0) throw new Error("Empty response");

    const contentType =
      response.headers.get("content-type") || guessMimeFromExt(cleanUrl);

    let filename = "media";
    try {
      const last = urlObj.pathname.split("/").pop();
      if (last) filename = last.split("?")[0];
    } catch {
      // Ignore parsing errors for filename extraction
    }
    filename = ensureExtByMime(filename, contentType);

    const result: MediaFetchResult = {
      ok: true,
      name: filename,
      mime: contentType,
      bufferBase64: arrayBufferToBase64(arrayBuffer),
      size: arrayBuffer.byteLength,
      originalUrl: url,
    };
    console.log("[Background] Fetch successful:", {
      name: result.name,
      mime: result.mime,
      size: result.size,
    });
    return result;
  } catch (error: unknown) {
    console.error("[Background] fetchMediaFromUrl error:", error);
    const msg =
      error && typeof error === 'object' && 'name' in error && error.name === "AbortError"
        ? "Request timeout - file too large or server too slow"
        : (error && typeof error === 'object' && 'message' in error ? (error as Error).message : String(error));
    return { ok: false, name: "", mime: "", error: msg, originalUrl: url };
  }
}
