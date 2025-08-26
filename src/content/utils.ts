export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function guessMimeFromUrl(url: string): string {
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
export function ensureFilename(name: string, mime: string, fallbackUrl?: string): string {
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

// ======= Utils =======


export function delay(ms: number) {
return new Promise((res) => setTimeout(res, ms));
}