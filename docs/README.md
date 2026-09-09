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

> MV3 has no DOM/Worker context in the service worker. The offscreen document hosts the FFmpeg WASM worker used for MP3 conversion and the stream-fetching fallback. It is created lazily per download and closed when idle. No scripts execute inside it beyond the extension's own packaged code.

**Justification for storage**

> Stores only the user's own data locally: "Saved for later" bookmarks, download history, and in-progress job state so downloads survive service-worker restarts. Nothing stored is transmitted anywhere.

**Justification for remote code use**

> None — the package no longer contains or executes remote code. The prior
> sandboxed evaluator (evaluator.html with unsafe-eval) was removed in v1.0.1.
> In the privacy questionnaire answer **“Does your extension use remote
> code?” = No.** YouTube stream URLs are deciphered through the bundled
> client (PO-token/BotGuard), not by evaluating fetched player JS.

**Also required (outside Privacy tab)**

- Settings page: add a publisher contact email and verify it (Google emails a
  verification link). Publishing stays blocked until the email is verified.
- Tick the certification that data usage complies with the Developer Program Policies.

## 6 · Test instructions (reviewer form)

No login/authentication exists, so the Username/Password fields stay empty.
Paste the following into **Additional instructions**:

```
No login or setup required. The extension needs no account, no API key, and no configuration. Install it from this listing, pin it to the toolbar, and grant the permissions shown at install time.

1) Single video download
- Open any public YouTube video, click the toolbar icon to open the popup.
- Paste the video URL (or just a video ID) and press Load.
- Confirm the preview card shows title, channel, thumbnail and duration.
- Pick a format (e.g. 720p MP4) and press Download.
- Confirm Chrome's download manager receives the file and it plays locally.

2) MP3 conversion
- Load a video, choose "MP3 Audio (converted via FFmpeg)" and press Download.
- Status shows "Transcoding MP3 via FFmpeg…", a progress bar advances, and an .mp3 lands in Chrome's Downloads. First conversion can take a few seconds while the FFmpeg WASM core loads.

3) Playlist + batch
- Paste a YouTube playlist URL and press Load; the card lists tracks with thumbnails.
- Use Get on one track, or Download all to enqueue the whole playlist; the progress line shows "Batch downloading (n/total)".

4) Save for later
- With a video preview loaded press Save later (it turns red/"Saved").
- Open the Saved tab, confirm the video is listed, and click the row to reopen it.

5) History
- After a download, open the History tab and confirm the entry shows title, format badge (MP4/MP3/WEBM) and relative time.
- Use the trash icon on a row and Clear all to remove entries.

Notes for the reviewer
- MP3 conversion and all processing happen locally; the extension only contacts youtube.com and googlevideo.com endpoints.
- If a download fails with "Video is unavailable or YouTube updated its extraction player", YouTube has changed its internals; a retry after a moment usually succeeds. This is a known limitation of YouTube downloaders, not a permissions defect.
- No credentials, PII or user content is transmitted anywhere; test data lives only in local extension storage.
```
