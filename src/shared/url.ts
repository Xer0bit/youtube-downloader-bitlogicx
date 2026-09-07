/** URL parsing for YouTube links, IDs, and playlist links. */

/** Extracts a video ID from watch/shorts/embed/youtu.be URLs (or raw IDs). */
export function extractVideoId(input: string): string | null {
  try {
    const parsed = new URL(input);
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be") {
      return parsed.pathname.slice(1).split("/")[0] || null;
    }
    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      if (
        parsed.pathname.startsWith("/shorts/") ||
        parsed.pathname.startsWith("/embed/")
      ) {
        return parsed.pathname.split("/")[2] || null;
      }
      return parsed.searchParams.get("v");
    }
    return null;
  } catch {
    return null;
  }
}

/** Extracts a playlist id from a `list=` query parameter, if present. */
export function extractPlaylistId(input: string): string | null {
  const match = input.match(/[&?]list=([^&]+)/);
  return match ? match[1] : null;
}
