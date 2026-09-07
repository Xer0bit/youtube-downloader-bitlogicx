import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

// MV3 extension build.
// - static/ is copied verbatim to dist/ (manifest, HTML pages, rules,
//   ffmpeg core, worker asset). It is the extension's static payload.
// - src/{background,popup,offscreen}/index.ts are the three JS entry points.
//   Their emitted names are fixed ([name].bundle.js) because manifest.json and
//   the HTML pages reference them by those exact paths.
// - `yt-webpo` aliases the frozen youtubei.js/PO-token snapshot in vendor/.
//   It is bundled as a normal module so youtubei.js internals stay untouched
//   in vendor/ while still being minified into the output.
export default defineConfig({
  publicDir: "static",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "esnext",
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      input: {
        background: fileURLToPath(new URL("./src/background/index.ts", import.meta.url)),
        popup: fileURLToPath(new URL("./src/popup/index.ts", import.meta.url)),
        offscreen: fileURLToPath(new URL("./src/offscreen/index.ts", import.meta.url)),
      },
      output: {
        entryFileNames: "[name].bundle.js",
        chunkFileNames: "[name].bundle.js",
        assetFileNames: "assets/[name][extname]",
        format: "es",
      },
    },
  },
  resolve: {
    alias: {
      "yt-webpo": fileURLToPath(new URL("./vendor/webpo.bundle.js", import.meta.url)),
    },
  },
});
