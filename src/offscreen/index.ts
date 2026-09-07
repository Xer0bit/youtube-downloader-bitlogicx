/**
 * Offscreen document ("FFmpeg Processor").
 *
 * Owns the FFmpeg WASM core and stream fetching. Messages from the background
 * service worker are gated on `target === 'offscreen'` because
 * `runtime.sendMessage` broadcasts to every extension context.
 *
 * Flow: background asks us to either (a) CONVERT_TO_MP3 - transcode an audio
 * stream with ffmpeg into a downloadable MP3 blob, or (b)
 * PREPARE_MEDIA_DOWNLOAD - proxy the media stream into a blob URL the download
 * manager can save. Stream progress is reported back as
 * `DOWNLOAD_PROGRESS` messages.
 */
import { FFmpeg } from "./ffmpeg";
import { getFallbackSession } from "../shared/yt";
import type {
  DownloadProgressReport,
  OffscreenConvertRequest,
  OffscreenPrepareRequest,
} from "../types/messages";

let ffmpeg: FFmpeg | null = null;

async function ensureFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg && ffmpeg.loaded) return ffmpeg;
  ffmpeg = new FFmpeg();
  const coreURL = chrome.runtime.getURL("ffmpeg-core.js");
  const wasmURL = chrome.runtime.getURL("ffmpeg-core.wasm");
  await ffmpeg.load({ coreURL, wasmURL });
  return ffmpeg;
}

function reportProgress(
  jobId: string,
  phase: string,
  loaded = 0,
  total = 0,
  percent?: number,
): void {
  if (!jobId) return;
  const report: DownloadProgressReport = {
    action: "DOWNLOAD_PROGRESS",
    jobId,
    phase,
    loaded,
    total,
    percent: Number.isFinite(percent) ? percent : undefined,
  };
  // Offscreen docs can be closed mid-flight; ignore "no receiver" errors.
  void chrome.runtime.sendMessage(report).catch(() => {});
}

/** Drains a response body into one Uint8Array while reporting progress. */
async function readBodyToBytes(
  body: ReadableStream<Uint8Array>,
  jobId: string,
  expectedTotal = 0,
): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    reportProgress(
      jobId,
      "Fetching media stream...",
      total,
      expectedTotal,
      expectedTotal > 0 ? Math.min(84, (total / expectedTotal) * 84) : undefined,
    );
  }
  if (total === 0) throw Error("YouTube returned an empty audio stream");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchBytesFrom(
  url: string,
  jobId: string,
): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
    });
    if (response.ok && response.body) {
      return readBodyToBytes(
        response.body,
        jobId,
        Number(response.headers.get("content-length")) || 0,
      );
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Audio stream bytes for MP3 conversion. Tries the supplied source URL first;
 * falls back to re-resolving the video through the ANDROID client when the
 * direct stream URL fails (403 / expired) or is absent.
 */
async function fetchAudioBytes(
  videoId: string,
  sourceUrl?: string,
  jobId = "",
): Promise<Uint8Array> {
  if (sourceUrl) {
    const direct = await fetchBytesFrom(sourceUrl, jobId);
    if (direct) return direct;
  }
  const session = await getFallbackSession();
  try {
    const info = await session.getBasicInfo(videoId, { client: "ANDROID" });
    const stream =
      info.streaming_data?.formats?.find((f) => f.has_audio) ||
      info.streaming_data?.adaptive_formats?.find((f) => f.has_audio);
    if (stream?.url) {
      const bytes = await fetchBytesFrom(stream.url, jobId);
      if (bytes) return bytes;
    }
  } catch {
    /* fall through to the error below */
  }
  throw Error("YouTube media stream could not be downloaded. Please retry.");
}

/**
 * Media bytes for a direct video download (progressive stream). Same
 * direct-then-fallback strategy as `fetchAudioBytes`.
 */
async function fetchMediaBytes(
  videoId: string,
  sourceUrl?: string,
  jobId = "",
): Promise<Uint8Array> {
  if (sourceUrl) {
    const direct = await fetchBytesFrom(sourceUrl, jobId);
    if (direct) return direct;
  }
  const session = await getFallbackSession();
  try {
    const info = await session.getBasicInfo(videoId, { client: "ANDROID" });
    const stream =
      info.streaming_data?.formats?.find((f) => f.has_video && f.has_audio) ||
      info.streaming_data?.adaptive_formats?.[0];
    if (stream?.url) {
      const bytes = await fetchBytesFrom(stream.url, jobId);
      if (bytes) return bytes;
    }
  } catch {
    /* fall through to the error below */
  }
  throw Error("Media stream could not be downloaded.");
}

async function convertToMp3(request: OffscreenConvertRequest): Promise<unknown> {
  const core = await ensureFFmpeg();
  const audioBytes = await fetchAudioBytes(
    request.videoId,
    request.sourceUrl,
    request.jobId,
  );
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const inputFile = `in_${stamp}.mp4`;
  const outputFile = `out_${stamp}.mp3`;
  await core.writeFile(inputFile, audioBytes);
  await core.exec([
    "-i",
    inputFile,
    "-vn",
    "-acodec",
    "libmp3lame",
    "-q:a",
    "2",
    outputFile,
  ]);
  const outputBytes = (await core.readFile(outputFile)) as Uint8Array;
  const blob = new Blob([outputBytes.buffer as ArrayBuffer], { type: "audio/mp3" });
  const blobUrl = URL.createObjectURL(blob);
  try {
    await core.deleteFile(inputFile);
    await core.deleteFile(outputFile);
  } catch {
    /* best effort cleanup */
  }
  return { success: true, blobUrl };
}

async function prepareMediaDownload(
  request: OffscreenPrepareRequest,
): Promise<unknown> {
  const mediaBytes = await fetchMediaBytes(
    request.videoId,
    request.sourceUrl,
    request.jobId,
  );
  const mimeType =
    String(request.mimeType || "").split(";")[0] || "application/octet-stream";
  return {
    success: true,
    blobUrl: URL.createObjectURL(new Blob([mediaBytes.buffer as ArrayBuffer], { type: mimeType })),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== "offscreen") return;

  const respondError = (error: unknown) =>
    sendResponse({ success: false, error: String((error as Error)?.message || error) });

  if (message.action === "CONVERT_TO_MP3") {
    void convertToMp3(message as OffscreenConvertRequest)
      .then(sendResponse)
      .catch(respondError);
    return true;
  }
  if (message.action === "PREPARE_MEDIA_DOWNLOAD") {
    void prepareMediaDownload(message as OffscreenPrepareRequest)
      .then(sendResponse)
      .catch(respondError);
    return true;
  }
  return undefined;
});
