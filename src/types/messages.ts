/**
 * Cross-context message contracts.
 *
 * Contexts: popup (UI) -> background (service worker router) -> offscreen
 * (ffmpeg + stream fetch). The evaluator sandbox (evaluator.html) is separate
 * and speaks postMessage (YT_EVALUATOR_*), not runtime messages.
 */

/** A normalized, playable stream format as returned by the background. */
export interface MediaFormat {
  itag?: number | string;
  mimeType?: string;
  width?: number;
  height?: number;
  quality?: string;
  url: string;
}

export interface ResolvedVideo {
  title: string;
  author: string;
  duration: number;
  thumbnail: string;
  formats: MediaFormat[];
}

export interface PlaylistItem {
  videoId?: string;
  title: string;
  duration: string;
  thumbnail: string;
}

export interface ResolvedPlaylist {
  title: string;
  items: PlaylistItem[];
}

/** Persisted shape of `chrome.storage.local` key `singleDownloadState`. */
export interface SingleDownloadState {
  running: boolean;
  jobId?: string;
  phase?: string;
  downloadId?: number;
  loaded?: number;
  total?: number;
  percent?: number;
  startedAt?: number;
}

/** Persisted shape of `chrome.storage.local` key `batchState`. */
export interface BatchState {
  isRunning: boolean;
  total: number;
  current: number;
  title: string;
  successCount: number;
  failedCount: number;
}

export type OkResponse<T = Record<string, unknown>> = { success: true } & T;

export type ErrResponse = {
  success: false;
  error: string;
};

export type ActionResponse<T = Record<string, unknown>> = OkResponse<T> | ErrResponse;

/* ----------------------------- Popup -> background ---------------------------- */

export interface ResolveVideoRequest {
  action: "RESOLVE_METADATA" | "GET_FORMATS";
  videoId: string;
}

export interface ResolvePlaylistRequest {
  action: "RESOLVE_PLAYLIST";
  playlistId: string;
}

export interface BatchJobRequest {
  action: "START_BATCH_JOB";
  items: PlaylistItem[];
}

export interface DownloadRequest {
  action: "DOWNLOAD";
  url: string;
  title: string;
  mime?: string;
  videoId: string;
  targetFormat?: "mp3";
  height?: number;
  quality?: string;
  itag?: number | string;
}

/* -------------------------- Offscreen -> background --------------------------- */

export interface DownloadProgressReport {
  action: "DOWNLOAD_PROGRESS";
  jobId: string;
  phase: string;
  loaded: number;
  total: number;
  percent?: number;
}

/* -------------------------- Background -> offscreen --------------------------- */

export interface OffscreenConvertRequest {
  action: "CONVERT_TO_MP3";
  videoId: string;
  sourceUrl: string;
  jobId: string;
}

export interface OffscreenPrepareRequest {
  action: "PREPARE_MEDIA_DOWNLOAD";
  videoId: string;
  sourceUrl: string;
  mimeType?: string;
  height?: number;
  quality?: string;
  itag?: number | string;
  jobId: string;
}

/* ------------------------ Popup-local library (storage) ----------------------- */

/** Entry in `chrome.storage.local` key `savedVideos` ("save for later"). */
export interface SavedVideo {
  videoId: string;
  title: string;
  author?: string;
  thumbnail?: string;
  duration?: number;
  savedAt: number;
}

/** Entry in `chrome.storage.local` key `downloadHistory` (written by background). */
export interface DownloadHistoryEntry {
  id: string;
  videoId?: string;
  title: string;
  /** File extension without dot: mp4 / m4a / webm / mp3. */
  ext: string;
  ts: number;
}
