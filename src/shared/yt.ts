/**
 * Typed façade over the frozen `yt-webpo` runtime snapshot (see vendor/).
 *
 * Owns session creation (with PO-token seeding) and all YouTube metadata
 * resolution. The bootstrap initializers must run exactly once per execution
 * context (service worker, offscreen document), which is what this module
 * scope does: whoever imports it triggers them.
 */
import {
  a as CacheStoreCtor,
  i as SessionFactory,
  n as LocalToken,
  o as BootstrapInitA,
  t as BootstrapInitB,
} from "yt-webpo";
import type {
  MediaFormat,
  ResolvedPlaylist,
  ResolvedVideo,
} from "../types/messages";

// One-time bootstrap of the PO-token / BotGuard subsystem, per context.
BootstrapInitA();
BootstrapInitB();

export type SessionSeed = "web_visitor_session" | "offscreen_session";

/** Structural surface of the Innertube-ish session this project uses. */
export interface YtBasicFormat {
  itag?: number | string;
  mime_type?: string;
  width?: number;
  height?: number;
  quality_label?: string;
  has_audio?: boolean;
  has_video?: boolean;
  url?: string;
  signature_cipher?: string;
  cipher?: string;
  decipher?: (player: unknown) => unknown;
}

export interface YtStreamingData {
  formats?: YtBasicFormat[];
  adaptive_formats?: YtBasicFormat[];
}

export interface YtPlaylistVideo {
  content_id?: string;
  video_id?: string;
  id?: string;
  title?:
    | { text?: string; toString(): string }
    | string;
  duration?: { text?: string };
  renderer_context?: {
    command_context?: { on_tap?: { payload?: { videoId?: string } } };
    accessibility_context?: { label?: string };
  };
}

export interface YtPlaylist {
  info?: { title?: string };
  videos?: YtPlaylistVideo[];
  has_continuation: boolean;
  getContinuation(): Promise<YtPlaylist>;
}

export interface YtSession {
  session: { player: unknown };
  getBasicInfo(
    videoId: string,
    options?: { client?: string },
  ): Promise<{
    basic_info?: {
      title?: string;
      author?: string;
      duration?: number;
      thumbnail?: Array<{ url?: string }>;
    };
    streaming_data?: YtStreamingData;
  }>;
  getPlaylist(playlistId: string): Promise<YtPlaylist>;
}

// Memoized per context and per seed.
const sessionCache = new Map<SessionSeed, Promise<YtSession>>();

export function getYtSession(seed: SessionSeed): Promise<YtSession> {
  let session = sessionCache.get(seed);
  if (!session) {
    session = createYtSession(seed);
    sessionCache.set(seed, session);
  }
  return session;
}

async function createYtSession(seed: SessionSeed): Promise<YtSession> {
  // Generate a local PO token seeded by the session key. When this fails we
  // fall back to session-local generation.
  let poToken: string | undefined;  try {
    poToken = await LocalToken(seed);
  } catch (error) {
    console.warn("PoToken fallback initialized:", error);
  }
  const session = await SessionFactory.create({
    cache: new CacheStoreCtor(false),
    generate_session_locally: true,
    po_token: poToken ?? undefined,
    fetch: globalThis.fetch.bind(globalThis),
  });
  return session as YtSession;
}

/** Session used by the offscreen fallback path (mp3 / direct media fetch). */
export function getFallbackSession(): Promise<YtSession> {
  return getYtSession("offscreen_session");
}

/** Thrown when both client variants fail to produce basic info. */
export const YOUTUBE_RESOLVE_ERROR =
  "Video is unavailable or YouTube updated its extraction player";

const THUMBNAIL_FALLBACK = (videoId: string) =>
  `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

/**
 * Normalizes one raw streaming format into a playable MediaFormat, resolving
 * the URL through the player decipher when the format only ships a cipher.
 */
async function normalizeFormat(
  format: YtBasicFormat,
  player: unknown,
): Promise<MediaFormat | null> {
  let url = format.url;
  if (
    !url &&
    (format.signature_cipher || format.cipher) &&
    typeof format.decipher === "function"
  ) {
    try {
      url = (await format.decipher(player)) as string;
    } catch {
      return null;
    }
  }
  if (typeof url !== "string" || !url.startsWith("https://")) return null;
  return {
    itag: format.itag,
    mimeType: format.mime_type,
    width: format.width,
    height: format.height,
    quality: format.quality_label || "Audio",
    url,
  };
}

/**
 * Resolves video metadata and playable stream formats. Both MWEB and ANDROID
 * clients are queried in parallel and each is fallible; if both fail the video
 * is considered unavailable. Formats: progressive (video) from both clients,
 * then audio-only adaptive streams (MWEB first, ANDROID second).
 */
export async function resolveVideo(videoId: string): Promise<ResolvedVideo> {
  const session = await getYtSession("web_visitor_session");
  const [mweb, android] = await Promise.all([
    session.getBasicInfo(videoId, { client: "MWEB" }).catch(() => null),
    session.getBasicInfo(videoId, { client: "ANDROID" }).catch(() => null),
  ]);
  if (!mweb && !android) throw new Error(YOUTUBE_RESOLVE_ERROR);

  const title = mweb?.basic_info?.title || android?.basic_info?.title || "video";
  const author = mweb?.basic_info?.author || android?.basic_info?.author || "";
  const duration = mweb?.basic_info?.duration || android?.basic_info?.duration || 0;
  const thumbnail =
    mweb?.basic_info?.thumbnail?.[0]?.url ||
    android?.basic_info?.thumbnail?.[0]?.url ||
    THUMBNAIL_FALLBACK(videoId);

  const audioOnly = (f: YtBasicFormat) => f.has_audio && !f.has_video;
  const candidates = [
    ...(android?.streaming_data?.formats ?? []),
    ...(mweb?.streaming_data?.formats ?? []),
    ...(mweb?.streaming_data?.adaptive_formats ?? []).filter(audioOnly),
    ...(android?.streaming_data?.adaptive_formats ?? []).filter(audioOnly),
  ];

  const player = session.session.player;
  const formats = (
    await Promise.all(
      candidates.map(async (format) => normalizeFormat(format, player)),
    )
  ).filter((format): format is MediaFormat => format !== null);

  if (formats.length === 0)
    throw new Error("No playable stream formats available for this video");
  return { title, author, duration, thumbnail, formats };
}

/**
 * Resolves a playlist page plus up to five continuation pages worth of videos.
 */
export async function resolvePlaylist(playlistId: string): Promise<ResolvedPlaylist> {
  const session = await getYtSession("web_visitor_session");
  const firstPage = await session.getPlaylist(playlistId);
  let page = firstPage;
  const videos = [...(firstPage.videos ?? [])];
  let remaining = 5;
  while (page.has_continuation && remaining > 0) {
    try {
      page = await page.getContinuation();
      videos.push(...(page.videos ?? []));
    } catch {
      break;
    }
    remaining--;
  }
  return {
    title: firstPage.info?.title || "YouTube Playlist",
    items: videos
      .map((video) => {
        const videoId =
          video.content_id ||
          video.video_id ||
          video.id ||
          video.renderer_context?.command_context?.on_tap?.payload?.videoId;
        let videoTitle = "";
        if (typeof video.title === "string") videoTitle = video.title;
        else {
          videoTitle =
            video.title?.text || (video.title as { toString?: () => string })?.toString?.() || "";
        }
        return {
          videoId,
          title:
            videoTitle ||
            video.renderer_context?.accessibility_context?.label ||
            "Video",
          duration: video.duration?.text || "",
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        };
      })
      .filter((item) => Boolean(item.videoId)),
  };
}
