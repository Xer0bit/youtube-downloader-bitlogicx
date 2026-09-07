/** Filename sanitation and download source guards. */

/** Matches the 6..20 char base64-ish YouTube video IDs. */
export const VALID_VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

/**
 * Output-filename sanitizer: strips path/control characters, trims trailing
 * dots, caps at 150 chars. Falls back to `video`.
 */
export function sanitizeFilename(name?: string): string {
  return (
    String(name || "video")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
      .replace(/\.+$/g, "")
      .trim()
      .slice(0, 150) || "video"
  );
}

/**
 * Only URLs produced internally (blob: from the offscreen document) or
 * official googlevideo stream URLs may be handed to the download manager.
 */
export function isAllowedDownloadSource(url: unknown): boolean {
  if (!url || typeof url !== "string") return false;
  if (url.startsWith("blob:chrome-extension://")) return true;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname.endsWith(".googlevideo.com") ||
        parsed.hostname === "googlevideo.com")
    );
  } catch {
    return false;
  }
}
