/**
 * Type surface for the frozen youtubei.js / PO-token runtime snapshot.
 *
 * The real implementation lives in `vendor/webpo.bundle.js` (748 KB single-file
 * ESM). Vite resolves the `yt-webpo` alias to that file; this declaration file
 * only exists so TypeScript understands the import. Do not hand-edit
 * `webpo.bundle.js`; treat it as a vendored library snapshot.
 *
 * Exports (semantics inferred from how this project consumes them):
 *  - `a`: Cache-store class. Construct `new a(false)` and pass as `cache`.
 *  - `i`: Session factory. `i.create({...})` returns an Innertube-like session.
 *  - `n`: Local PO-token / visitor-data generator. `n(seed)` -> token string.
 *  - `o`, `t`: Idempotent bootstrap initializers for the PO-token/BotGuard
 *    subsystem. Both are invoked once at module load.
 *  - `r`: Internal helper, not consumed by this project.
 */
export declare const a: any;
export declare const i: any;
export declare const n: any;
export declare const o: any;
export declare const r: any;
export declare const t: any;
