// Generates an interactive, self-contained demo of the popup at docs/demo/popup.html
// for the GitHub Pages landing page and for store screenshots.
//
// The demo is the REAL popup markup/CSS/bundle with two injected scripts:
//  1. a chrome.* stub (runs before the bundle) that seeds sample Saved/History
//     data and answers RESOLVE_METADATA / RESOLVE_PLAYLIST with canned results
//  2. a driver that, given ?state=idle|video|playlist|saved|history|progress,
//     drives the real UI into that state (so screenshots capture actual pixels)
//
// Run: node scripts/build-demo.mjs   (writes docs/demo/)
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_HTML = join(ROOT, "static", "popup.html");
const BUNDLE = join(ROOT, "dist", "popup.bundle.js");
const OUT = join(ROOT, "docs", "demo");

/* ------------------------------- thumbnails ------------------------------ */

const svgThumb = (label, c1, c2) =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='480' height='270'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${c1}'/><stop offset='1' stop-color='${c2}'/></linearGradient></defs><rect width='480' height='270' fill='url(#g)'/><circle cx='430' cy='36' r='120' fill='rgba(255,255,255,.07)'/><text x='50%' y='52%' fill='rgba(255,255,255,.92)' font-family='-apple-system,Segoe UI,sans-serif' font-size='34' font-weight='700' text-anchor='middle'>${label}</text></svg>`,
  );

/* ------------------------------ chrome stub ------------------------------ */

const now = Date.now();
const stub = `
<script>
(function () {
  "use strict";
  var thumb = function (label, c1, c2) {
    return "data:image/svg+xml," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='480' height='270'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='" + c1 + "'/><stop offset='1' stop-color='" + c2 + "'/></linearGradient></defs><rect width='480' height='270' fill='url(#g)'/><text x='50%' y='54%' fill='rgba(255,255,255,.92)' font-family='-apple-system,Segoe UI,sans-serif' font-size='40' font-weight='700' text-anchor='middle'>" + label + "</text></svg>");
  };
  var day = 86400000;
  var seed = {
    savedVideos: [
      { videoId: "dQw4w9WgXcQ", title: "Lofi hip hop radio — beats to relax/study to", author: "Lofi Girl", thumbnail: thumb("LIVE", "#141a4a", "#7b5bd6"), duration: 5412, savedAt: ${now - 86400000 * 1} },
      { videoId: "PzY9P3k3wMs", title: "How a V8 engine actually works", author: "Engineering Explained", thumbnail: thumb("V8", "#3d1d1f", "#d6302f"), duration: 1893, savedAt: ${now - 86400000 * 2} },
      { videoId: "M7lc1UVf-VY", title: "Everything is a remix — 4K", author: "Kiran John", thumbnail: thumb("REMAKE", "#0e3340", "#2aa8c0"), duration: 529, savedAt: ${now - 86400000 * 4} }
    ],
    downloadHistory: [
      { id: "d1", videoId: "hnpILIIo9_I", title: "The Science of Perfect Sleep (4K)", ext: "mp4", ts: ${now - 1000 * 60 * 42} },
      { id: "d2", videoId: "dQw4w9WgXcQ", title: "Lofi hip hop radio — beats to relax/study to", ext: "mp3", ts: ${now - 86400000 * 1} },
      { id: "d3", videoId: "9bZkp7q19f0", title: "Kurzgesagt — What is a black hole?", ext: "webm", ts: ${now - 86400000 * 2} },
      { id: "d4", videoId: "abcXYZ98765", title: "The Primeagen — TypeScript deep dive", ext: "mp4", ts: ${now - 86400000 * 6} }
    ],
    singleDownloadState: undefined,
    batchState: undefined
  };
  var store = JSON.parse(JSON.stringify(seed));
  var META = {
    success: true,
    title: "The Science of Perfect Sleep — 4K Documentary",
    author: "Curiosity Stream",
    duration: 1872,
    thumbnail: thumb("4K SLEEP", "#101a33", "#5b8def"),
    formats: [
      { itag: 137, mimeType: "video/mp4; codecs=\\"avc1.640028\\"", width: 1920, height: 1080, quality: "1080p", url: "https://cdn.example/f1.mp4" },
      { itag: 22, mimeType: "video/mp4; codecs=\\"avc1.64001F\\"", width: 1280, height: 720, quality: "720p", url: "https://cdn.example/f2.mp4" },
      { itag: 18, mimeType: "video/mp4; codecs=\\"avc1.42001E\\"", width: 640, height: 360, quality: "360p", url: "https://cdn.example/f3.mp4" },
      { itag: 140, mimeType: "audio/mp4; codecs=\\"mp4a.40.2\\"", quality: "Audio", url: "https://cdn.example/f4.m4a" },
      { itag: 251, mimeType: "audio/webm; codecs=\\"opus\\"", quality: "Audio", url: "https://cdn.example/f5.webm" }
    ]
  };
  var PLAYLIST = {
    success: true,
    title: "Focus & Study Mix",
    items: [
      "Lo-fi beats", "Deep focus", "Late night drive", "Rainy day cafe", "Synthwave study",
      "Chillhop", "Piano for focus", "Ambient space"
    ].map(function (t, i) {
      return { videoId: "pl" + i + "demo0", title: t, duration: "4:2" + i, thumbnail: thumb(t.toUpperCase(), "#23263a", i % 2 ? "#3a6ea5" : "#a53a6e") };
    })
  };
  window.chrome = {
    runtime: {
      sendMessage: function (msg) {
        return new Promise(function (resolve) {
          var a = msg && msg.action;
          if (a === "RESOLVE_METADATA" || a === "GET_FORMATS") resolve(META);
          else if (a === "RESOLVE_PLAYLIST") resolve(PLAYLIST);
          else resolve({ success: true, error: undefined, downloadId: 1 });
        });
      },
      getURL: function (p) { return p; },
      lastError: undefined
    },
    storage: {
      local: {
        get: function (keys, cb) {
          var out = {};
          (Array.isArray(keys) ? keys : [keys]).forEach(function (k) { if (k in store) out[k] = store[k]; });
          cb(out);
        },
        set: function (obj, cb) { Object.keys(obj).forEach(function (k) { store[k] = obj[k]; }); cb && cb(); }
      }
    },
    downloads: { download: function () {}, search: function (_q, cb) { cb && cb([]); }, onChanged: { addListener: function () {} } },
    tabs: { create: function () {} },
    offscreen: { createDocument: function () {}, closeDocument: function () {}, getContexts: function () {} },
    action: { setBadgeText: function () {} }
  };
})();
</script>`;

/* -------------------------------- driver -------------------------------- */

const driver = `
<script>
(function () {
  var state = new URLSearchParams(location.search).get("state") || "idle";
  var video = new URLSearchParams(location.search).get("video") || "dQw4w9WgXcQ";
  window.addEventListener("DOMContentLoaded", function () {
    setTimeout(function () {
      var $ = function (id) { return document.getElementById(id); };
      if (state === "video") {
        $("url").value = "https://www.youtube.com/watch?v=" + video;
        $("load-btn").click();
      } else if (state === "playlist") {
        $("url").value = "https://www.youtube.com/playlist?list=PLdemo1234";
        $("load-btn").click();
      } else if (state === "saved") {
        $("tab-saved").click();
      } else if (state === "history") {
        $("tab-history").click();
      } else if (state === "progress") {
        chrome.storage.local.set({
          singleDownloadState: { running: true, jobId: "demo1", phase: "Fetching media stream…", percent: 62, startedAt: Date.now() }
        });
      }
    }, 320);
  });
})();
</script>
`;

/* -------------------------------- assemble -------------------------------- */

mkdirSync(join(OUT, "icons"), { recursive: true });

let html = readFileSync(SRC_HTML, "utf8");
html = html.replace(
  /<script type="module"[^>]*src="\/popup\.bundle\.js"><\/script>/,
  `${stub}\n  <script type="module" crossorigin src="./popup.bundle.js"></script>\n  ${driver}`,
);
html = html.replaceAll('src="/icons/logo-yt-downloader.png"', 'src="./icons/logo-yt-downloader.png"');
// Keep any iframe gutters the same gray as the popup canvas.
html = html.replace("</head>", '<style>html{background:#f2f2f4}</style></head>');

writeFileSync(join(OUT, "popup.html"), html);
copyFileSync(BUNDLE, join(OUT, "popup.bundle.js"));
for (const icon of ["logo-yt-downloader.png", "icon-48.png", "icon-128.png"]) {
  copyFileSync(join(ROOT, "static", "icons", icon), join(OUT, "icons", icon));
}
console.log("demo written to docs/demo/");
