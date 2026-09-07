<div align="center">

<img src="static/icons/logo-yt-downloader.png" alt="Bit Downloader logo" width="96">

# Bit Downloader

**Download YouTube videos, audio and whole playlists straight from your browser toolbar.**

Manifest V3 Chrome extension. Fully client-side: stream fetching, MP3 conversion and everything else runs locally in your browser. No servers, no accounts.

</div>

---

## Features

- **Video downloads** in your choice of quality and container (MP4 / WebM / M4A), straight from the format list
- **MP3 conversion** powered by FFmpeg compiled to WebAssembly, executed in an offscreen document
- **Playlists**: resolve a whole playlist, download individual tracks, or batch-download all of them in the background
- **Save for later**: bookmark videos and come back to them from the Saved tab
- **Download history**: every download is recorded with its format, so you can reopen or re-download anytime
- **Progress everywhere**: live progress bar and status that stay visible no matter which tab of the popup you are on
- Clean, flat, minimal UI with a tab bar for Download / Saved / History

## Install

### From source (recommended for now)

1. Clone this repository
2. `npm install`
3. `npm run build`
4. Open `chrome://extensions`, enable **Developer mode**
5. Click **Load unpacked** and select the generated `dist/` folder

Rebuild with `npm run build` after any change and hit the reload icon on the extension card. For a watch loop use `npm run watch`.

### Requirements

- Node.js 20.19 or newer (for building from source only, the built extension needs no Node)
- Chrome / Chromium based browser with Manifest V3 support

## Usage

1. Click the toolbar icon to open the popup
2. Paste a YouTube video, Shorts or playlist link, then press **Load** (or Enter)
3. Pick a format and press **Download**, or choose **MP3 Audio** to convert
4. Use **Save later** to bookmark the video, and check the **History** tab to revisit past downloads

## Project structure

```
├── src/
│   ├── background/       MV3 service worker: router, download orchestration, batch jobs, history
│   ├── popup/            Toolbar UI logic (Download / Saved / History views)
│   ├── offscreen/        Offscreen document: FFmpeg WASM wrapper + stream fetching
│   ├── shared/           Session/YouTube resolution, URL parsing, filename sanitizing
│   └── types/            Cross-context message contracts and stored-state shapes
├── static/               Copied verbatim into dist/: manifest, pages, icons, FFmpeg core
├── vendor/               Frozen youtubei.js / PO-token runtime snapshot (do not edit)
├── scripts/gen-icons.mjs Dependency-free PNG tool that resizes the logo into icon set
└── dist/                 Build output, this is what you load unpacked
```

## How it works

```
Popup (UI)  →  Background (service worker)  →  Offscreen (FFmpeg + streams)
                                   ↓
                          chrome.downloads
```

- **Resolution** uses an embedded youtubei.js client. Metadata is queried with the `MWEB` and `ANDROID` client variants in parallel, and stream URLs are deciphered when needed through a sandboxed page.
- **Header rewriting** (Origin/Referer) is done through the extension's `declarativeNetRequest` rules so `googlevideo.com` stream requests look like first-party requests. MV3 pages cannot set these headers from `fetch`.
- **MP3 conversion** happens in an offscreen document running FFmpeg WASM; the audio never leaves the machine.
- **State** survives service-worker restarts: in-flight jobs are persisted under `chrome.storage.local` and reconciled through the downloads API. History and bookmarks live there too (`downloadHistory`, `savedVideos`).

The heavy runtime (youtubei.js client + PO-token/BotGuard bootstrap) is frozen in `vendor/webpo.bundle.js`. When YouTube changes its internals and downloads break, that snapshot, the client variants, or the DNR rules are usually where the fix lands.

## Scripts

| Command | Purpose |
|---|---|
| `npm run build` | Production build into `dist/` (deterministic, byte-identical across runs) |
| `npm run watch` | Rebuild on file changes |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run icons` | Regenerate PNG icons from `static/icons/logo-yt-downloader.png` |

## Privacy

All processing happens locally in your browser. The extension talks only to YouTube/google video endpoints needed to resolve and fetch streams; there is no analytics, no telemetry, and no third-party server in the loop. The data it stores (bookmarks, download history, in-flight job state) is kept in `chrome.storage.local` on your machine.

## Permissions explained

| Permission | Why |
|---|---|
| `downloads` | Save files through Chrome's download manager |
| `offscreen` | Host the FFmpeg WASM worker and sandboxed decipher page |
| `declarativeNetRequest` | Rewrite Origin/Referer on YouTube stream requests (see above) |
| `storage` | Bookmark, history and in-flight job state |
| `youtube.com`, `googlevideo.com` host access | Metadata and stream endpoints |

## Disclaimer

Downloading content from YouTube may violate YouTube's Terms of Service. This project is provided for research and personal archival of content you have rights to. Respect copyright and platform rules; the authors are not responsible for how you use it. YouTube internals change often, so downloads can break at any time without notice.

## Tech stack

Manifest V3, TypeScript, Vite 7, FFmpeg WASM (`@ffmpeg/core` 0.12.9), youtubei.js snapshot, `chrome.storage`, zero runtime dependencies beyond the vendored client.
