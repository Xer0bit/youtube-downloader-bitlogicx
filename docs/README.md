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
Bit Downloader

Download YouTube videos, audio and whole playlists straight from your browser toolbar. Paste a link, pick a quality, done. No servers, no accounts, no watermarks: everything runs locally in your browser.

Why you will like it

- One-click downloads from any YouTube page, Shorts or playlist
- Choose the quality you want: 4K, 1080p, 720p and below
- Grab clean video (MP4, WebM) or audio-only files (M4A)
- Convert any video to MP3 instantly with FFmpeg compiled to WebAssembly. The conversion happens on your device, so your audio never leaves your machine
- Load full playlists, browse every track, and download them one by one
- Send an entire playlist to a background batch queue and let it work through the list
- Save videos for later and reopen them any time from the Saved tab
- Automatic download history with format badges, so you can revisit or clean up past downloads
- Live progress that stays visible no matter which view you are in

Clean and native feel

The popup uses a flat, Apple-inspired interface: grouped cards, a segmented control for Download / Saved / History, and quiet typography. No clutter, no ads, no upsells.

Private by design

- No server, no account, and no analytics
- Media is fetched directly through your browser
- MP3 conversion runs locally via FFmpeg WASM
- Bookmarks, history and job state live only in Chrome's own local storage on your device
- Only the network permissions needed to fetch and save media are requested, and they are explained in the permissions note below

How to use

1. Click the toolbar icon to open the popup
2. Paste a YouTube video, Shorts or playlist link and press Load
3. Choose a format or MP3 and press Download
4. Optionally bookmark the video with Save later, and check the History tab to revisit past downloads

Compatibility

Works in Chrome and Chromium browsers on desktop. Manifest V3.

Notes

- Please respect copyright and only download content you have the rights to save. YouTube's Terms of Service may restrict downloading
- YouTube changes its internal systems frequently. If a download stops working, an extension update usually resolves it
- For support or feature requests, use the support URL on this listing
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

## 5 · Privacy practices tab — copy-paste answers (publish blockers)

Paste these in the **Privacy practices** tab of the item page, tick the
Developer Program Policies certification, then Save Draft and Submit.

**Single purpose description**

> Download YouTube videos and playlists to the user's own device, including MP3 conversion, all processed locally in the browser.

**Justification for declarativeNetRequest**

> MV3 forbids extensions from setting the Origin/Referer headers on fetch() requests. This extension uses one static DNR ruleset to rewrite those two headers to https://www.youtube.com only on requests to youtube.com/youtubei/* and googlevideo.com/videoplayback* media endpoints, so YouTube serves the requested stream. Rules are static, fixed at install, and match only YouTube domains.

**Justification for downloads**

> Saves the downloaded video/audio file through Chrome's built-in download manager. A download starts only after the user explicitly clicks Download on a resolved video.

**Justification for host permissions**

> Required to resolve video metadata and stream URLs and to allow the static DNR header rewrite on media endpoints. Network access happens only when the user pastes a link and requests a download.

**Justification for offscreen**

> MV3 has no DOM/Worker context in the service worker. The offscreen document hosts the FFmpeg WASM worker used for MP3 conversion and the sandboxed iframe that executes YouTube's player code (see remote-code justification). It is created lazily per download and closed when idle.

**Justification for storage**

> Stores only the user's own data locally: "Saved for later" bookmarks, download history, and in-progress job state so downloads survive service-worker restarts. Nothing stored is transmitted anywhere.

**Justification for remote code use**

> YouTube signs its media URLs with an obfuscated JavaScript algorithm fetched from YouTube's own player endpoint. To decipher a stream URL for a video the user requested, this code must be executed. It runs only inside a dedicated sandboxed iframe whose CSP explicitly allows unsafe-eval (extension pages themselves never use it), executes only code fetched from YouTube's player, only on demand, and never executes third-party or developer-hosted code.

**Also required (outside Privacy tab)**

- Settings page: add a publisher contact email and verify it (Google emails a
  verification link). Publishing stays blocked until the email is verified.
- Tick the certification that data usage complies with the Developer Program Policies.
- Remote-code justification is the highest-risk item in review; if rejected,
  the fix is to remove runtime execution of fetched player JS entirely.
