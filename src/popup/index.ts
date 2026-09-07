/**
 * Toolbar popup UI logic. Talks to the background service worker via
 * `chrome.runtime.sendMessage` (RESOLVE_METADATA / RESOLVE_PLAYLIST /
 * DOWNLOAD / START_BATCH_JOB) and polls persisted download state from
 * `chrome.storage.local` about once per second.
 *
 * Three views (tabs): Download (URL + preview/playlist), Saved (bookmarks the
 * user stores with "Save later"), History (downloads recorded by the
 * background worker). Saved and History persist under `chrome.storage.local`
 * keys `savedVideos` and `downloadHistory`.
 */
import { extractPlaylistId, extractVideoId } from "../shared/url";
import type {
  DownloadHistoryEntry,
  MediaFormat,
  PlaylistItem,
  ResolvedPlaylist,
  SavedVideo,
} from "../types/messages";

const SAVED_KEY = "savedVideos";
const HISTORY_KEY = "downloadHistory";

type ViewName = "download" | "saved" | "history";

/* ------------------------------------------------------------------ */
/* DOM helpers                                                         */
/* ------------------------------------------------------------------ */

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function setStatus(text: string, className = ""): void {
  const status = byId("status");
  status.textContent = text;
  status.className = className;
  syncEmptyState();
}

function setEmptyStateVisible(visible: boolean): void {
  const empty = document.getElementById("empty-state");
  if (empty) empty.style.display = visible ? "block" : "none";
}

/** Hide the hint hero whenever real content or progress is on screen. */
function syncEmptyState(): void {
  const busy = ["loading", "preview-card", "playlist-card", "progress-container"].some(
    (id) => byId<HTMLElement>(id).style.display === "flex",
  );
  setEmptyStateVisible(!busy);
}

function sendMessage<T = Record<string, unknown>>(message: unknown): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (stored) => resolve(stored[key] as T | undefined));
  });
}

function storageSet(key: string, value: unknown): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set({ [key]: value }, resolve));
}

/* ------------------------------------------------------------------ */
/* Pop-out handling                                                    */
/* ------------------------------------------------------------------ */

const popoutButton = byId("popout-btn");
if (popoutButton) {
  if (window.innerWidth > 500) {
    popoutButton.style.display = "none";
  } else {
    popoutButton.addEventListener("click", () => {
      void chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
    });
  }
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

let currentTitle = "";
let currentFormats: MediaFormat[] = [];
let currentPlaylist: ResolvedPlaylist | null = null;
let currentVideo: {
  videoId: string;
  title: string;
  author: string;
  thumbnail: string;
  duration?: number;
} | null = null;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function formatClock(seconds?: number): string {
  if (!seconds) return "00:00";
  const total = parseInt(String(seconds), 10);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

const WATCH_URL = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;
const THUMB_URL = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

function makeIconButton(kind: "go" | "del", label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = `icon-btn ${kind}`;
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  if (kind === "go") {
    path.setAttribute("d", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4");
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("points", "7 10 12 15 17 10");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "12");
    line.setAttribute("y1", "15");
    line.setAttribute("x2", "12");
    line.setAttribute("y2", "3");
    svg.append(path, polyline, line);
  } else {
    path.setAttribute("d", "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6");
    svg.appendChild(path);
  }
  button.appendChild(svg);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

/* ------------------------------------------------------------------ */
/* Tab / view switching                                                */
/* ------------------------------------------------------------------ */

function activateView(view: ViewName): void {
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll<HTMLElement>(".view").forEach((section) => {
    const active = section.id === `view-${view}`;
    section.classList.toggle("active", active);
    section.hidden = !active;
  });
  if (view === "saved") void renderSaved();
  if (view === "history") void renderHistory();
  void refreshCounts();
  syncEmptyState();
}

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

function setCount(elId: string, n: number): void {
  const el = byId(elId);
  el.textContent = n > 99 ? "99+" : String(n);
  el.classList.toggle("has", n > 0);
}

async function refreshCounts(): Promise<void> {
  const [saved, history] = await Promise.all([
    storageGet<SavedVideo[]>(SAVED_KEY),
    storageGet<DownloadHistoryEntry[]>(HISTORY_KEY),
  ]);
  setCount("count-saved", saved?.length ?? 0);
  setCount("count-history", history?.length ?? 0);
}

/* ------------------------------------------------------------------ */
/* Save for later                                                      */
/* ------------------------------------------------------------------ */

function setSaveButtonVisual(): void {
  const button = byId<HTMLButtonElement>("save-btn");
  const label = byId("save-btn-label");
  const saved = currentVideo !== null && byId("save-btn").classList.contains("saved");
  label.textContent = saved ? "Saved" : "Save later";
  button.classList.toggle("saved", saved);
  button.title = saved ? "Remove from Saved" : "Save for later";
}

async function toggleSaveCurrent(): Promise<void> {
  if (!currentVideo) return;
  const list = (await storageGet<SavedVideo[]>(SAVED_KEY)) ?? [];
  const existing = list.find((item) => item.videoId === currentVideo!.videoId);
  const button = byId<HTMLButtonElement>("save-btn");
  if (existing) {
    await storageSet(
      SAVED_KEY,
      list.filter((item) => item.videoId !== currentVideo!.videoId),
    );
    button.classList.remove("saved");
  } else {
    await storageSet(SAVED_KEY, [
      {
        videoId: currentVideo.videoId,
        title: currentVideo.title,
        author: currentVideo.author,
        thumbnail: currentVideo.thumbnail,
        duration: currentVideo.duration,
        savedAt: Date.now(),
      },
      ...list,
    ]);
    button.classList.add("saved");
  }
  button.classList.remove("pop");
  // reflow so the pop animation replays on every toggle
  void button.offsetWidth;
  button.classList.add("pop");
  setSaveButtonVisual();
  await refreshCounts();
  if (byId("view-saved").classList.contains("active")) void renderSaved();
}

/* ------------------------------------------------------------------ */
/* Library list rows (shared)                                          */
/* ------------------------------------------------------------------ */

function buildLibraryRow(opts: {
  thumb: string;
  title: string;
  subtitle: string;
  onClick: () => void;
  actions: Array<{ kind: "go" | "del"; label: string; run: () => void }>;
}): HTMLElement {
  const row = document.createElement("div");
  row.className = "lib-row";
  row.tabIndex = 0;
  row.setAttribute("role", "button");

  const thumb = document.createElement("img");
  thumb.className = "lib-thumb";
  thumb.src = opts.thumb;
  thumb.alt = "";
  thumb.loading = "lazy";

  const mid = document.createElement("div");
  mid.className = "lib-mid";
  const name = document.createElement("div");
  name.className = "lib-name";
  name.textContent = opts.title;
  const sub = document.createElement("div");
  sub.className = "lib-sub";
  sub.innerHTML = "";
  sub.appendChild(document.createTextNode(opts.subtitle));
  mid.append(name, sub);

  const actions = document.createElement("div");
  actions.className = "lib-actions";
  for (const action of opts.actions) actions.appendChild(makeIconButton(action.kind, action.label, action.run));

  const open = () => {
    opts.onClick();
  };
  row.appendChild(thumb);
  row.appendChild(mid);
  row.appendChild(actions);
  row.addEventListener("click", open);
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });
  return row;
}

/* ------------------------------------------------------------------ */
/* Saved view                                                          */
/* ------------------------------------------------------------------ */

async function renderSaved(): Promise<void> {
  const list = (await storageGet<SavedVideo[]>(SAVED_KEY)) ?? [];
  const container = byId("saved-list");
  const empty = byId("saved-empty");
  container.innerHTML = "";
  empty.hidden = list.length > 0;
  for (const item of list) {
    const duration = item.duration ? formatClock(item.duration) : "";
    const subtitleParts = [item.author || "Unknown channel"];
    if (duration) subtitleParts.push(duration);
    const row = buildLibraryRow({
      thumb: item.thumbnail || THUMB_URL(item.videoId),
      title: item.title || "Untitled video",
      subtitle: subtitleParts.join("  •  "),
      onClick: () => openAgain(item.videoId),
      actions: [{ kind: "del", label: "Remove from Saved", run: () => void removeSaved(item.videoId) }],
    });
    container.appendChild(row);
  }
}

async function removeSaved(videoId: string): Promise<void> {
  const list = (await storageGet<SavedVideo[]>(SAVED_KEY)) ?? [];
  await storageSet(SAVED_KEY, list.filter((item) => item.videoId !== videoId));
  if (currentVideo?.videoId === videoId) {
    byId<HTMLButtonElement>("save-btn").classList.remove("saved");
    setSaveButtonVisual();
  }
  await refreshCounts();
  if (byId("view-saved").classList.contains("active")) void renderSaved();
}

/* ------------------------------------------------------------------ */
/* History view                                                        */
/* ------------------------------------------------------------------ */

async function renderHistory(): Promise<void> {
  const list = (await storageGet<DownloadHistoryEntry[]>(HISTORY_KEY)) ?? [];
  const container = byId("history-list");
  const empty = byId("history-empty");
  const head = byId("history-head");
  container.innerHTML = "";
  empty.hidden = list.length > 0;
  head.classList.toggle("has-items", list.length > 0);
  for (const entry of list) {
    const badge = document.createElement("span");
    badge.className = `ext ${entry.ext === "mp3" ? "mp3" : "other"}`;
    badge.textContent = entry.ext.toUpperCase();
    const subtitleHolder = document.createElement("span");
    subtitleHolder.textContent = timeAgo(entry.ts);
    const row = buildLibraryRow({
      thumb: entry.videoId ? THUMB_URL(entry.videoId) : "",
      title: entry.title || "Untitled download",
      subtitle: "",
      onClick: () => {
        if (entry.videoId) openAgain(entry.videoId);
        else void navigator.clipboard.writeText(entry.title);
      },
      actions: [
        ...(entry.videoId
          ? [{ kind: "go" as const, label: "Open video", run: () => openAgain(entry.videoId!) }]
          : []),
        { kind: "del" as const, label: "Remove from history", run: () => void removeHistory(entry.id) },
      ],
    });
    // add the time + extension badge into the subtitle line
    const sub = row.querySelector<HTMLElement>(".lib-sub");
    if (sub) {
      sub.appendChild(subtitleHolder);
      sub.appendChild(badge);
    }
    container.appendChild(row);
  }
}

async function removeHistory(id: string): Promise<void> {
  const list = (await storageGet<DownloadHistoryEntry[]>(HISTORY_KEY)) ?? [];
  await storageSet(HISTORY_KEY, list.filter((entry) => entry.id !== id));
  await refreshCounts();
  if (byId("view-history").classList.contains("active")) void renderHistory();
}

async function clearHistory(): Promise<void> {
  await storageSet(HISTORY_KEY, []);
  await refreshCounts();
  if (byId("view-history").classList.contains("active")) void renderHistory();
}

/* ------------------------------------------------------------------ */
/* Progress polling                                                    */
/* ------------------------------------------------------------------ */

let lastProgressText = "";

function refreshProgress(): void {
  chrome.storage.local.get(["batchState", "singleDownloadState"], (stored) => {
    const batch = stored.batchState as
      | { isRunning: boolean; total: number; current: number; title: string }
      | undefined;
    const single = stored.singleDownloadState as
      | { running: boolean; percent?: number; phase?: string }
      | undefined;
    const container = byId<HTMLDivElement>("progress-container");
    const fill = byId<HTMLDivElement>("progress-fill");
    const statusEl = byId("status");
    if (single?.running) {
      container.style.display = "block";
      const percent = single.percent || 0;
      fill.style.width = `${percent}%`;
      lastProgressText = `${single.phase || "Downloading..."}${percent ? `  ${Math.round(percent)}%` : ""}`;
      setStatus(lastProgressText);
    } else if (batch?.isRunning) {
      container.style.display = "block";
      const percent = (batch.current / batch.total) * 100;
      fill.style.width = `${percent}%`;
      lastProgressText = `Batch downloading (${batch.current}/${batch.total}): ${batch.title.slice(0, 25)}...`;
      setStatus(lastProgressText);
    } else {
      container.style.display = "none";
      fill.style.width = "0%";
      if (statusEl.textContent === lastProgressText) setStatus("");
      syncEmptyState();
    }
  });
  void refreshCounts();
}

setInterval(refreshProgress, 1000);
refreshProgress();

/* ------------------------------------------------------------------ */
/* Single-video resolution                                             */
/* ------------------------------------------------------------------ */

async function loadVideo(videoId: string): Promise<void> {
  try {
    const response = await sendMessage<{
      success: boolean;
      error?: string;
      title?: string;
      author?: string;
      duration?: number;
      thumbnail?: string;
      formats?: MediaFormat[];
    }>({ action: "RESOLVE_METADATA", videoId });
    byId("loading").style.display = "none";
    if (!response || !response.success) {
      setStatus(`Error: ${response?.error || "Failed to fetch formats"}`, "status-msg error");
      return;
    }
    currentTitle = response.title || "YouTube Video";
    currentFormats = response.formats || [];
    currentVideo = {
      videoId,
      title: currentTitle,
      author: response.author || "",
      thumbnail:
        response.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      duration: response.duration,
    };
    byId<HTMLDivElement>("video-title").textContent = currentTitle;
    byId<HTMLDivElement>("video-author").textContent = response.author || "";
    byId<HTMLImageElement>("thumb-img").src = currentVideo.thumbnail;
    byId<HTMLDivElement>("duration-badge").textContent = formatClock(response.duration);

    const select = byId<HTMLSelectElement>("format-select");
    select.innerHTML = "";

    const videoGroup = document.createElement("optgroup");
    videoGroup.label = "Video formats";
    const audioGroup = document.createElement("optgroup");
    audioGroup.label = "Audio";

    // MP3 conversion is always offered for the audio group.
    const mp3Option = document.createElement("option");
    mp3Option.value = "MP3_CONVERT";
    mp3Option.textContent = "MP3 Audio (converted via FFmpeg)";
    audioGroup.appendChild(mp3Option);

    // One entry per height (video) and per codec (audio), highest first.
    const seenHeights = new Set<number>();
    const seenAudio = new Set<string>();
    currentFormats
      .map((format, originalIndex) => ({ ...format, originalIndex }))
      .sort((a, b) => (b.height || 0) - (a.height || 0))
      .forEach((format) => {
        const option = document.createElement("option");
        option.value = String(format.originalIndex);
        if (format.height) {
          if (seenHeights.has(format.height)) return;
          seenHeights.add(format.height);
          const containerType = String(format.mimeType || "")
            .split(";")[0]
            .split("/")[1]
            .toUpperCase();
          option.textContent = `${format.height}p Video (${containerType})`;
          videoGroup.appendChild(option);
        } else {
          const audioType = String(format.mimeType || "").includes("mp4") ? "M4A" : "WEBM";
          if (seenAudio.has(audioType)) return;
          seenAudio.add(audioType);
          option.textContent = `High Quality Audio (${audioType})`;
          audioGroup.appendChild(option);
        }
      });

    if (videoGroup.children.length > 0) select.appendChild(videoGroup);
    if (audioGroup.children.length > 0) select.appendChild(audioGroup);

    byId<HTMLDivElement>("preview-card").style.display = "flex";
    syncEmptyState();

    // reflect whether the currently shown video is already saved
    const saved = (await storageGet<SavedVideo[]>(SAVED_KEY)) ?? [];
    byId<HTMLButtonElement>("save-btn").classList.toggle(
      "saved",
      saved.some((item) => item.videoId === videoId),
    );
    setSaveButtonVisual();
  } catch (error) {
    byId("loading").style.display = "none";
    setStatus(`Error: ${String((error as Error)?.message || error)}`, "status-msg error");
  }
}

/* ------------------------------------------------------------------ */
/* Playlist rendering                                                  */
/* ------------------------------------------------------------------ */

function renderPlaylist(playlist: ResolvedPlaylist): void {
  byId("loading").style.display = "none";
  currentPlaylist = playlist;
  byId<HTMLDivElement>("playlist-title").textContent = playlist.title || "Playlist";
  byId<HTMLDivElement>("playlist-count").textContent = `${playlist.items.length} videos`;

  const list = byId<HTMLDivElement>("track-list");
  list.innerHTML = "";
  playlist.items.forEach((item, index) => {
    const watchUrl = WATCH_URL(item.videoId || "");
    const card = document.createElement("div");
    card.className = "track-item-card";

    const top = document.createElement("div");
    top.className = "track-top";

    const thumb = document.createElement("img");
    thumb.className = "track-thumb";
    thumb.src = item.thumbnail;
    thumb.alt = "Thumb";

    const details = document.createElement("div");
    details.className = "track-details";

    const title = document.createElement("div");
    title.className = "track-title";
    title.textContent = `${index + 1}. ${item.title}`;

    const buttons = document.createElement("div");
    buttons.className = "track-btns";

    const copyButton = document.createElement("button");
    copyButton.className = "btn-sm btn-outline copy-link-btn";
    copyButton.type = "button";
    copyButton.textContent = "Copy";
    copyButton.addEventListener("click", () => {
      void navigator.clipboard.writeText(watchUrl).then(() => {
        copyButton.textContent = "Copied";
        setTimeout(() => {
          copyButton.textContent = "Copy";
        }, 1500);
      });
    });

    const downloadButton = document.createElement("button");
    downloadButton.className = "btn-sm btn-action download-track-btn";
    downloadButton.type = "button";
    downloadButton.textContent = "Get";
    downloadButton.addEventListener("click", () => {
      void downloadPlaylistItem(item);
    });

    buttons.appendChild(copyButton);
    buttons.appendChild(downloadButton);
    details.appendChild(title);
    details.appendChild(buttons);
    top.appendChild(thumb);
    top.appendChild(details);
    card.appendChild(top);
    list.appendChild(card);
  });

  byId<HTMLDivElement>("playlist-card").style.display = "flex";
  syncEmptyState();
}

async function downloadPlaylistItem(item: PlaylistItem): Promise<void> {
  setStatus(`Fetching download for: ${item.title.slice(0, 25)}...`);
  try {
    const meta = await sendMessage<{
      success: boolean;
      title?: string;
      formats?: MediaFormat[];
    }>({ action: "RESOLVE_METADATA", videoId: item.videoId });
    if (meta?.success && meta.formats && meta.formats.length > 0) {
      const chosen =
        meta.formats.find((f) => f.height === 720 || f.height === 360) || meta.formats[0];
      const result = await sendMessage<{ success: boolean; error?: string }>({
        action: "DOWNLOAD",
        url: chosen.url,
        title: meta.title,
        mime: chosen.mimeType,
        videoId: item.videoId,
      });
      if (result?.success) {
        setStatus(`Download started: ${item.title.slice(0, 22)}…`, "status-msg success");
        void refreshCounts();
      } else {
        setStatus(`Download failed for item: ${result?.error || "Unknown"}`, "status-msg error");
      }
    } else {
      setStatus("Could not fetch formats for this video.", "status-msg error");
    }
  } catch (error) {
    setStatus(
      `Download failed for item: ${String((error as Error)?.message || error)}`,
      "status-msg error",
    );
  }
}

/* ------------------------------------------------------------------ */
/* Single-video download (from the format dropdown)                    */
/* ------------------------------------------------------------------ */

async function downloadSelectedFormat(videoId: string | null): Promise<void> {
  const select = byId<HTMLSelectElement>("format-select");
  const value = select.value;
  if (value === "MP3_CONVERT") {
    const chosen =
      currentFormats.find((f) => f.height && f.mimeType?.includes("mp4")) ||
      currentFormats.find((f) => f.mimeType?.includes("audio")) ||
      currentFormats[0];
    if (!chosen || !videoId) return;
    setStatus("Transcoding MP3 via FFmpeg…");
    try {
      const result = await sendMessage<{ success: boolean; error?: string }>({
        action: "DOWNLOAD",
        url: chosen.url,
        title: currentTitle,
        mime: chosen.mimeType,
        targetFormat: "mp3",
        videoId,
      });
      if (result?.success) {
        setStatus("MP3 converted — download started!", "status-msg success");
        void refreshCounts();
      } else {
        setStatus(`MP3 conversion error: ${result?.error || ""}`, "status-msg error");
      }
    } catch (error) {
      setStatus(
        `MP3 conversion error: ${String((error as Error)?.message || error)}`,
        "status-msg error",
      );
    }
    return;
  }

  const format = currentFormats[Number(value)];
  if (!format) return;
  setStatus("Starting download…");
  try {
    const result = await sendMessage<{ success: boolean; error?: string }>({
      action: "DOWNLOAD",
      url: format.url,
      title: currentTitle,
      mime: format.mimeType,
      videoId: videoId || undefined,
    });
    if (result?.success) {
      setStatus("Download started! Check Chrome downloads.", "status-msg success");
      void refreshCounts();
    } else {
      setStatus(`Failed to start download: ${result?.error || ""}`, "status-msg error");
    }
  } catch (error) {
    setStatus(
      `Failed to start download: ${String((error as Error)?.message || error)}`,
      "status-msg error",
    );
  }
}

/* ------------------------------------------------------------------ */
/* Load submission (button, Enter key, library "open")                 */
/* ------------------------------------------------------------------ */

async function submitLoad(): Promise<void> {
  const input = byId<HTMLInputElement>("url").value.trim();
  const playlistId = extractPlaylistId(input);
  const videoId = extractVideoId(input);
  if (!playlistId && !videoId) {
    setStatus("Enter a valid YouTube URL, video or playlist ID.", "status-msg error");
    return;
  }
  setStatus("", "status-msg");
  byId("loading").style.display = "flex";
  byId<HTMLDivElement>("preview-card").style.display = "none";
  byId<HTMLDivElement>("playlist-card").style.display = "none";
  setEmptyStateVisible(false);

  if (playlistId) {
    try {
      const response = await sendMessage<{
        success: boolean;
        error?: string;
        items?: PlaylistItem[];
        title?: string;
      }>({ action: "RESOLVE_PLAYLIST", playlistId });
      if (!response || !response.success || !response.items || response.items.length === 0) {
        if (videoId) {
          await loadVideo(videoId);
        } else {
          byId("loading").style.display = "none";
          setEmptyStateVisible(true);
          setStatus("Playlist is empty or could not be loaded.", "status-msg error");
        }
        return;
      }
      renderPlaylist({ title: response.title || "Playlist", items: response.items });
    } catch (error) {
      byId("loading").style.display = "none";
      setEmptyStateVisible(true);
      setStatus(
        `Playlist could not be loaded: ${String((error as Error)?.message || error)}`,
        "status-msg error",
      );
    }
    return;
  }
  if (videoId) void loadVideo(videoId);
}

function openAgain(videoId: string): void {
  activateView("download");
  byId<HTMLInputElement>("url").value = WATCH_URL(videoId);
  void submitLoad();
}

/* ------------------------------------------------------------------ */
/* Event wiring                                                        */
/* ------------------------------------------------------------------ */

byId("load-btn").addEventListener("click", () => void submitLoad());

byId<HTMLInputElement>("url").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void submitLoad();
  }
});

byId("download-btn").addEventListener("click", () => {
  const videoId =
    extractVideoId(byId<HTMLInputElement>("url").value.trim()) ??
    currentVideo?.videoId ??
    null;
  void downloadSelectedFormat(videoId);
});

byId("save-btn").addEventListener("click", () => void toggleSaveCurrent());

for (const view of ["download", "saved", "history"] as ViewName[]) {
  byId<HTMLButtonElement>(`tab-${view}`).addEventListener("click", () => activateView(view));
}

byId("batch-download-btn").addEventListener("click", () => {
  if (!currentPlaylist || !currentPlaylist.items || currentPlaylist.items.length === 0) return;
  setStatus("Submitting batch job to background queue...");
  void (async () => {
    try {
      const response = await sendMessage<{ success: boolean; error?: string }>({
        action: "START_BATCH_JOB",
        items: currentPlaylist.items,
      });
      if (response?.success) {
        setStatus("Batch job started in the background!", "status-msg success");
      } else {
        setStatus(
          `Failed to start batch job: ${response?.error || "Unknown error"}`,
          "status-msg error",
        );
      }
    } catch (error) {
      setStatus(
        `Failed to start batch job: ${String((error as Error)?.message || error)}`,
        "status-msg error",
      );
    }
  })();
});

byId("clear-history").addEventListener("click", () => void clearHistory());

void refreshCounts();
