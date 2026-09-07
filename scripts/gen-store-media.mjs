// Generates the store-listing HTML pages that are rendered to upload-ready PNG
// screenshots with headless Chrome (see gen-store-media.sh / the commands below).
//
// Output pages (under store/source/), each sized exactly for the store spec:
//   screenshot-{video,playlist,saved,history}.html   1280x800  (main screenshots)
//   promo-small.html                                  440x280  (small promo tile)
//   promo-marquee.html                               1400x560  (marquee promo tile)
//   icon-store.html                                   128x128  (store icon, opaque)
//
// Screenshot pages embed the real popup (docs/demo/popup.html?state=…) at its
// natural pixel size so the capture is crisp.
//
// Render one page with, e.g.:
//   google-chrome --headless=new --hide-scrollbars --window-size=1280,800 \
//     --screenshot=store/screenshot-video.png \
//     http://127.0.0.1:PORT/store/source/screenshot-video.html
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "store", "source");
mkdirSync(OUT, { recursive: true });

const DEMO = "/docs/demo/popup.html";
const LOGO = "/docs/demo/icons/logo-yt-downloader.png";

/* The measured natural height of the popup body per demo state. */
const HEIGHT = { idle: 311, video: 549, playlist: 490, saved: 339, history: 407 };

function baseStyle(bg = "backdrop") {
  const backdrop =
    bg === "backdrop"
      ? `background:
        radial-gradient(1100px 520px at 16% -8%, rgba(255,59,48,.07), transparent 62%),
        radial-gradient(900px 640px at 102% 108%, rgba(0,122,255,.05), transparent 55%),
        #eef0f3;`
      : `background: ${bg};`;
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    body { ${backdrop} display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  `;
}

/* A clean capture of the real popup at 1:1, centered on a soft backdrop. */
function popupShotPage(w, h, state, logo = true) {
  const ph = HEIGHT[state] ?? 500;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle()}
    .frame {
      width: 424px; height: ${ph}px;
      background: #f2f2f4;
      border-radius: 22px;
      overflow: hidden;
      box-shadow: 0 30px 90px -18px rgba(20,20,30,.35), 0 3px 10px rgba(20,20,30,.08);
      outline: 1px solid rgba(0,0,0,.05);
    }
    .frame iframe { width: 424px; height: ${ph}px; border: 0; display: block; }
    .brand {
      position: fixed; top: 26px; left: 30px;
      display: flex; align-items: center; gap: 10px;
      color: #6b6b72; font-size: 15px; font-weight: 600; letter-spacing: -0.01em;
    }
    .brand img { width: 30px; height: 30px; border-radius: 7px; }
    .brand b { color: #1d1d1f; }
  </style></head><body>
    ${logo ? `<div class="brand"><img src="${LOGO}" alt=""><div><b>Bit Downloader</b> · popup</div></div>` : ""}
    <div class="frame"><iframe src="${DEMO}?state=${state}" scrolling="no"></iframe></div>
  </body></html>`;
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function marketingPage(w, h, inner) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle()}</style>
</head><body>${inner}</body></html>`;
}

/* ------------------------------- main screenshots ------------------------------ */

const shots = [
  ["screenshot-video.html", "video", 1280, 800],
  ["screenshot-playlist.html", "playlist", 1280, 800],
  ["screenshot-saved.html", "saved", 1280, 800],
  ["screenshot-history.html", "history", 1280, 800],
];
for (const [file, state] of shots) {
  writeFileSync(join(OUT, file), popupShotPage(1280, 800, state));
  console.log("wrote", file);
}

/* ------------------------------- promo tiles ------------------------------- */

writeFileSync(
  join(OUT, "promo-small.html"),
  marketingPage(440, 280, `
  <div style="width:440px;height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center;
    background:radial-gradient(420px 240px at 50% -30%, rgba(255,59,48,.28), transparent 70%), linear-gradient(160deg,#22242b,#0e0f13);
    color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center;padding:26px;">
    <img src="${LOGO}" width="72" height="72" style="border-radius:16px;margin-bottom:16px;">
    <div style="font-size:26px;font-weight:700;letter-spacing:-.02em;">Bit Downloader</div>
    <div style="margin-top:7px;font-size:13.5px;color:#b9bcc6;line-height:1.5;">YouTube videos, audio &amp; playlists<br>straight from your browser toolbar</div>
  </div>`),
  console.log("wrote promo-small.html"),
);

writeFileSync(
  join(OUT, "promo-marquee.html"),
  marketingPage(1400, 560, `
  <div style="width:1400px;height:560px;display:flex;align-items:center;gap:70px;padding:0 92px;
    background:radial-gradient(900px 480px at 92% -20%, rgba(255,59,48,.20), transparent 60%), radial-gradient(700px 480px at -5% 120%, rgba(0,122,255,.10), transparent 55%), linear-gradient(150deg,#20222a,#0d0e12);
    color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="flex:1;min-width:0;">
      <img src="${LOGO}" width="92" height="92" style="border-radius:20px;margin-bottom:22px;">
      <h1 style="font-size:58px;font-weight:800;letter-spacing:-.03em;line-height:1.04;">Download YouTube.<br><span style="color:#ff6b61;">Stay in your browser.</span></h1>
      <p style="margin-top:20px;font-size:21px;color:#c3c6d0;line-height:1.55;max-width:600px;">
        Video in every quality, MP3 via in-page FFmpeg, whole playlists at once.
        Save for later, download history, no servers, no accounts.
      </p>
      <div style="margin-top:30px;display:flex;gap:14px;">
        <span style="background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);border-radius:99px;padding:9px 18px;font-size:16px;font-weight:600;">4K · 1080p · 720p</span>
        <span style="background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);border-radius:99px;padding:9px 18px;font-size:16px;font-weight:600;">MP3 · M4A · WebM</span>
        <span style="background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);border-radius:99px;padding:9px 18px;font-size:16px;font-weight:600;">Playlists &amp; batches</span>
      </div>
    </div>
    <div style="width:424px;flex-shrink:0;border-radius:22px;overflow:hidden;outline:1px solid rgba(255,255,255,.14);box-shadow:0 40px 110px -20px rgba(0,0,0,.7);">
      <iframe src="${DEMO}?state=video" style="width:424px;height:549px;border:0;display:block;" scrolling="no"></iframe>
    </div>
  </div>`),
  console.log("wrote promo-marquee.html"),
);

/* ------------------------------- store icon ------------------------------- */

writeFileSync(
  join(OUT, "icon-store.html"),
  `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; }
    html, body { width:128px; height:128px; overflow:hidden; }
    body {
      background: radial-gradient(90px 60px at 28% -10%, rgba(255,59,48,.35), transparent 65%),
        linear-gradient(155deg, #2a2c35, #101116);
      display:flex; align-items:center; justify-content:center;
    }
    img { width:100px; height:100px; border-radius:22px; }
  </style></head><body><img src="${LOGO}" alt=""></body></html>`,
);
console.log("wrote icon-store.html");
