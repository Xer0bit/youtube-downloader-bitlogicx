/**
 * Background service worker: message router and download orchestrator.
 *
 * Popup -> background:
 *   RESOLVE_METADATA | GET_FORMATS | RESOLVE_PLAYLIST | START_BATCH_JOB |
 *   DOWNLOAD | DOWNLOAD_PROGRESS (offscreen -> background)
 *
 * MV3 lifecycle rule: nothing important lives only in memory. In-flight state
 * is persisted under `chrome.storage.local` (`singleDownloadState`,
 * `batchState`) and reconciled through the downloads API so work survives
 * service-worker restarts.
 */
import { resolvePlaylist, resolveVideo } from "../shared/yt";
import {
  isAllowedDownloadSource,
  sanitizeFilename,
  VALID_VIDEO_ID,
} from "../shared/sanitize";
import type {
  BatchJobRequest,
  BatchState,
  DownloadHistoryEntry,
  DownloadProgressReport,
  DownloadRequest,
  PlaylistItem,
  ResolvePlaylistRequest,
  ResolveVideoRequest,
  SingleDownloadState,
} from "../types/messages";

const OFFSCREEN_DOCUMENT = "offscreen.html";
const SINGLE_KEY = "singleDownloadState";
const BATCH_KEY = "batchState";
const HISTORY_KEY = "downloadHistory";
const HISTORY_MAX = 100;

/** How long a running lock with no downloadId stays valid after a restart. */
const LOCK_TTL_MS = 600_000;
/** Gap inserted between items of a batch job. */
const BATCH_GAP_MS = 1200;

/* ------------------------------------------------------------------ */
/* Download history (newest first, capped)                             */
/* ------------------------------------------------------------------ */

async function recordDownloadHistory(entry: Omit<DownloadHistoryEntry, "id" | "ts">): Promise<void> {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  const list = (stored[HISTORY_KEY] as DownloadHistoryEntry[] | undefined) ?? [];
  const full: DownloadHistoryEntry = {
    ...entry,
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
  };
  await chrome.storage.local.set({
    [HISTORY_KEY]: [full, ...list].slice(0, HISTORY_MAX),
  });
}

/* ------------------------------------------------------------------ */
/* Offscreen document lifecycle                                        */
/* ------------------------------------------------------------------ */

let openingOffscreen: Promise<void> | null = null;

async function ensureOffscreenDocument(url = OFFSCREEN_DOCUMENT): Promise<void> {
  const target = chrome.runtime.getURL(url);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [target],
  });
  if (contexts.length > 0) return;
  if (openingOffscreen) return openingOffscreen;
  openingOffscreen = chrome.offscreen.createDocument({
    url,
    reasons: ["WORKERS", "BLOBS"],
    justification: "FFmpeg WebAssembly audio transcoding",
  });
  try {
    await openingOffscreen;
  } finally {
    openingOffscreen = null;
  }
}

async function closeOffscreenDocument(): Promise<void> {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
    });
    if (contexts.length > 0) await chrome.offscreen.closeDocument();
  } catch {
    /* already gone */
  }
}

/* ------------------------------------------------------------------ */
/* Single-download lock (persisted across SW restarts)                 */
/* ------------------------------------------------------------------ */

/** In-memory guard: prevents two lock acquisitions racing in one context. */
let lockInFlight = false;

async function acquireDownloadLock(): Promise<boolean> {
  if (lockInFlight) return false;
  lockInFlight = true;
  try {
    const stored = await chrome.storage.local.get(SINGLE_KEY);
    const state = stored[SINGLE_KEY] as SingleDownloadState | undefined;
    if (state?.running) {
      let stillActive = false;
      if (state.downloadId) {
        const found = await chrome.downloads.search({ id: state.downloadId });
        stillActive = found.some((item) => item.state === "in_progress");
      } else {
        stillActive = Date.now() - Number(state.startedAt || 0) < LOCK_TTL_MS;
      }
      if (stillActive) return false;
    }
    await chrome.storage.local.set({
      [SINGLE_KEY]: { running: true, startedAt: Date.now() },
    });
    return true;
  } finally {
    lockInFlight = false;
  }
}

async function releaseDownloadLock(): Promise<void> {
  lockInFlight = false;
  await chrome.storage.local.set({ [SINGLE_KEY]: { running: false } });
}

/* ------------------------------------------------------------------ */
/* Downloads primitives                                                */
/* ------------------------------------------------------------------ */

/** Tracked downloadIds whose offscreen document should stay open. */
const pendingDownloads = new Set<number>();

function startBrowserDownload(
  url: string,
  filename: string,
  conflictAction: "uniquify" | "overwrite" | "prompt" = "uniquify",
): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url, filename, conflictAction },
      (downloadId?: number) => {
        if (chrome.runtime.lastError || !downloadId) {
          const message =
            chrome.runtime.lastError?.message || "Download initialization failed";
          reject(new Error(message));
        } else {
          resolve(downloadId);
        }
      },
    );
  });
}

/* ------------------------------------------------------------------ */
/* DOWNLOAD orchestration                                              */
/* ------------------------------------------------------------------ */

async function handleDownloadRequest(
  request: DownloadRequest,
): Promise<{ success: boolean; error?: string; downloadId?: number }> {
  let lockHeld = false;
  let usedOffscreen = false;
  try {
    lockHeld = await acquireDownloadLock();
    if (!lockHeld)
      throw new Error("Another download is already in progress");
    if (!isAllowedDownloadSource(request.url))
      throw new Error("Download URL is invalid or from an unapproved domain");

    const isMp3 = request.targetFormat === "mp3";
    const jobId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await chrome.storage.local.set({
      [SINGLE_KEY]: {
        running: true,
        jobId,
        phase: "Preparing download…",
        startedAt: Date.now(),
      },
    });

    // Container extension follows the requested mimeType.
    const hasVideo = !request.mime || request.mime.includes("video");
    const isMp4Container = !request.mime || request.mime.includes("mp4");
    const extension = isMp3
      ? ".mp3"
      : isMp4Container
        ? hasVideo
          ? ".mp4"
          : ".m4a"
        : ".webm";
    const filename = `${sanitizeFilename(request.title)}${extension}`;

    let blobUrl: string | undefined;
    if (isMp3) {
      if (!VALID_VIDEO_ID.test(String(request.videoId || "")))
        throw new Error("A valid YouTube video ID is required for MP3 conversion");
      await ensureOffscreenDocument();
      usedOffscreen = true;
      const response = (await chrome.runtime.sendMessage({
        target: "offscreen",
        action: "CONVERT_TO_MP3",
        videoId: request.videoId,
        sourceUrl: request.url,
        jobId,
      })) as { success?: boolean; error?: string; blobUrl?: string };
      if (!response?.success)
        throw new Error(response?.error || "MP3 conversion failed");
      blobUrl = response.blobUrl;
    } else {
      if (!VALID_VIDEO_ID.test(String(request.videoId || "")))
        throw new Error("A valid YouTube video ID is required for media download");
      await ensureOffscreenDocument();
      usedOffscreen = true;
      const response = (await chrome.runtime.sendMessage({
        target: "offscreen",
        action: "PREPARE_MEDIA_DOWNLOAD",
        videoId: request.videoId,
        sourceUrl: request.url,
        mimeType: request.mime,
        height: request.height,
        quality: request.quality,
        itag: request.itag,
        jobId,
      })) as { success?: boolean; error?: string; blobUrl?: string };
      if (!response?.success)
        throw new Error(response?.error || "Media download failed");
      blobUrl = response.blobUrl;
    }

    const downloadId = await startBrowserDownload(blobUrl as string, filename);
    pendingDownloads.add(downloadId);
    lockHeld = false;
    await chrome.storage.local.set({
      [SINGLE_KEY]: {
        running: true,
        downloadId,
        jobId,
        phase: "Saving file…",
        percent: 99,
        startedAt: Date.now(),
      },
    });
    void recordDownloadHistory({
      videoId: request.videoId || undefined,
      title: request.title,
      ext: extension.slice(1),
    });
    return { success: true, downloadId };
  } catch (error) {
    if (usedOffscreen) await closeOffscreenDocument();
    if (lockHeld) await releaseDownloadLock();
    return {
      success: false,
      error: String((error as Error)?.message || error),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Batch job                                                           */
/* ------------------------------------------------------------------ */

let batchRunning = false;

async function runBatchJob(items: PlaylistItem[]): Promise<void> {
  if (batchRunning) return;
  batchRunning = true;
  const total = items.length;
  let successCount = 0;
  let failedCount = 0;

  for (let index = 0; index < total; index++) {
    const item = items[index];
    const progress: BatchState = {
      isRunning: true,
      total,
      current: index + 1,
      title: item.title,
      successCount,
      failedCount,
    };
    await chrome.storage.local.set({ [BATCH_KEY]: progress });
    try {
      const meta = await resolveVideo(item.videoId || "");
      const chosen =
        meta.formats.find((f) => f.mimeType?.includes("mp4")) || meta.formats[0];
      if (chosen?.url) {
        const filename = `${sanitizeFilename(meta.title)}.mp4`;
        const downloadId = await startBrowserDownload(
          chosen.url,
          filename,
          "uniquify",
        );
        if (downloadId) {
          successCount++;
          void recordDownloadHistory({
            videoId: item.videoId || undefined,
            title: item.title || meta.title,
            ext: "mp4",
          });
        } else failedCount++;
      } else {
        failedCount++;
      }
    } catch {
      failedCount++;
    }
    if (index < total - 1)
      await new Promise((resolve) => setTimeout(resolve, BATCH_GAP_MS));
  }

  batchRunning = false;
  await chrome.storage.local.set({
    [BATCH_KEY]: {
      isRunning: false,
      total,
      current: total,
      title: "Completed",
      successCount,
      failedCount,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Offscreen progress reporting                                        */
/* ------------------------------------------------------------------ */

async function forwardProgress(report: DownloadProgressReport): Promise<void> {
  const stored = await chrome.storage.local.get(SINGLE_KEY);
  const state = stored[SINGLE_KEY] as SingleDownloadState | undefined;
  if (!state?.running || state.jobId !== report.jobId) return;
  const next: SingleDownloadState = {
    ...state,
    phase: report.phase,
    loaded: report.loaded,
    total: report.total,
  };
  if (Number.isFinite(report.percent)) next.percent = report.percent;
  else delete next.percent;
  await chrome.storage.local.set({ [SINGLE_KEY]: next });
}

/* ------------------------------------------------------------------ */
/* Message router                                                      */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  switch ((message as { action?: string }).action) {
    case "RESOLVE_PLAYLIST": {
      const { playlistId } = message as ResolvePlaylistRequest;
      void resolvePlaylist(playlistId)
        .then((result) => sendResponse({ success: true, ...result }))
        .catch((error) =>
          sendResponse({ success: false, error: String(error?.message || error) }),
        );
      return true;
    }
    case "GET_FORMATS":
    case "RESOLVE_METADATA": {
      const { videoId } = message as ResolveVideoRequest;
      void resolveVideo(videoId)
        .then((result) => sendResponse({ success: true, ...result }))
        .catch((error) =>
          sendResponse({ success: false, error: String(error?.message || error) }),
        );
      return true;
    }
    case "START_BATCH_JOB": {
      const { items } = message as BatchJobRequest;
      if (items && items.length > 0) {
        void runBatchJob(items);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: "No items in batch request" });
      }
      return true;
    }
    case "DOWNLOAD": {
      void handleDownloadRequest(message as DownloadRequest).then(sendResponse);
      return true;
    }
    case "DOWNLOAD_PROGRESS": {
      void forwardProgress(message as DownloadProgressReport);
      return false; // fire-and-forget; no response expected
    }
    default:
      return undefined;
  }
});

/* ------------------------------------------------------------------ */
/* Download lifecycle reconciliation                                   */
/* ------------------------------------------------------------------ */

chrome.downloads.onChanged.addListener((delta) => {
  const finished =
    delta.state?.current === "complete" ||
    delta.state?.current === "interrupted" ||
    Boolean(delta.error?.current);
  if (!finished) return;

  void (async () => {
    const stored = await chrome.storage.local.get(SINGLE_KEY);
    const state = stored[SINGLE_KEY] as SingleDownloadState | undefined;
    if (state?.downloadId !== delta.id) return;
    pendingDownloads.delete(delta.id);
    await releaseDownloadLock();
    if (pendingDownloads.size === 0) await closeOffscreenDocument();
  })();
});
