# GitHub Pages site & Chrome Web Store kit

## 1 · Publish the landing page (GitHub Pages)

The site lives in this `docs/` folder (root: `docs/index.html`, with the
interactive demo at `docs/demo/popup.html`). It is **live** at:

**https://xer0bit.github.io/youtube-downloader-bitlogicx/**

Repo: https://github.com/Xer0bit/youtube-downloader-bitlogicx (public,
Pages enabled from `/docs` on `main`, description + topics + homepage set).

To update the site after changes: `npm run build` (if UI changed),
`node scripts/build-demo.mjs`, then commit and push `main`. Pages rebuilds
in ~1 minute.

The demo (`docs/demo/popup.html`) is the real popup markup with a `chrome.*`
stub and sample data.

## 2 · Store listing copy

| Field | Value |
|---|---|
| Title (from package) | Bit Downloader |
| Summary (from package description) | Download YouTube videos, audio and playlists straight from your browser toolbar. |
| Category | Productivity (or Accessibility? — pick **Productivity**) |
| Language | English (United States) |
| Official URL / Homepage | https://xer0bit.github.io/youtube-downloader-bitlogicx/ |
| Support URL | https://github.com/Xer0bit/youtube-downloader-bitlogicx |

### Description (paste into the dashboard)

```
Bit Downloader adds a one-click download button for YouTube to your browser toolbar. Paste a video, Shorts or playlist link and preview every available quality — from 1080p/4K down to 360p — or grab a clean audio track. Convert any video to MP3 right in your browser with FFmpeg compiled to WebAssembly; the audio never leaves your machine.

WHAT YOU CAN DO
• Download video in your preferred quality and container (MP4, WebM, M4A)
• Convert to MP3 instantly, powered by local FFmpeg WASM
• Load full playlists, browse every track and download them one by one
• Batch-download an entire playlist in the background, one video after another
• Save videos for later and pick up where you left off from the Saved tab
• Keep a full download history with format badges — reopen or clean up anytime
• Watch live progress on a slim bar that stays visible in every view

A CLEAN, NATIVE FEEL
A flat, Apple-inspired interface: grouped cards, a segmented control for Download / Saved / History, and quiet typography. No clutter, no ads, no upsells.

PRIVATE BY DESIGN
There is no server, no account, and no analytics. Streams are resolved and fetched directly through your browser, MP3 conversion runs locally, and your bookmarks and history stay in Chrome's own storage on your device. Only the network permissions required to fetch and save media are requested.

NOTES
YouTube frequently changes its internals; if a download stops working, an extension update usually fixes it. Please respect copyright and only download content you have the rights to save.
```

## 3 · Upload-ready media (already generated)

All files are exact spec sizes, 24-bit PNG **without alpha**:

| Purpose | File | Size |
|---|---|---|
| Store icon | `store/icon-store.png` | 128×128 |
| Screenshot 1 — video preview | `store/screenshot-video.png` | 1280×800 |
| Screenshot 2 — playlist | `store/screenshot-playlist.png` | 1280×800 |
| Screenshot 3 — saved | `store/screenshot-saved.png` | 1280×800 |
| Screenshot 4 — history | `store/screenshot-history.png` | 1280×800 |
| Small promo tile | `store/promo-small.png` | 440×280 |
| Marquee promo tile | `store/promo-marquee.png` | 1400×560 |

Regenerate after UI changes:

```
node scripts/build-demo.mjs      # refresh docs/demo from the real popup
node scripts/gen-store-media.mjs # rewrite store/source/*.html frames
# then render each with headless Chrome, e.g.:
google-chrome --headless=new --hide-scrollbars --no-sandbox \
  --window-size=1280,800 --screenshot=store/screenshot-video.png \
  --virtual-time-budget=4500 http://127.0.0.1:PORT/store/source/screenshot-video.html
```

(Screenshots embed the demo popup at 1:1 through an iframe, so they are crisp.
Serve the repo root over HTTP while rendering — `python3 -m http.server 8393`.)

## 4 · Permissions & privacy fields

| Permission | Reason (for the dashboard) |
|---|---|
| `downloads` | Saving files through Chrome's download manager |
| `offscreen` | Running the FFmpeg WASM converter offscreen |
| `declarativeNetRequest` | Making YouTube stream requests appear first-party (required by MV3; headers cannot be set from fetch) |
| `storage` | Saved-for-later, download history, in-flight job state |
| YouTube / googlevideo host access | Resolving metadata and fetching media streams |

Privacy practice: single purpose = download media from YouTube for the user;
no user data is collected, transmitted, or sold.
