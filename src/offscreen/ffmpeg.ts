/**
 * Worker wrapper for the FFmpeg WASM core, ported from the
 * `@ffmpeg/ffmpeg@0.12.9` code originally embedded in this extension so the
 * worker protocol stays byte-compatible with the vendored worker asset
 * (`assets/worker-*.js`) and core (`ffmpeg-core.js` / `.wasm`).
 *
 * The actual transcoding runs inside a module worker that we spawn from
 * `assets/worker-*.js`; this class only does the message plumbing
 * (LOAD/EXEC/READ_FILE/... + progress/log events).
 */

const WORKER_URL = chrome.runtime.getURL("assets/worker-BzdDEeh7.js");

const ERROR_NOT_LOADED = Error("ffmpeg is not loaded, call `await ffmpeg.load()` first");
const ERROR_TERMINATED = Error("called FFmpeg.terminate()");

/** Message types spoken by the worker. */
enum FFMessageType {
  LOAD = "LOAD",
  EXEC = "EXEC",
  FFPROBE = "FFPROBE",
  WRITE_FILE = "WRITE_FILE",
  READ_FILE = "READ_FILE",
  DELETE_FILE = "DELETE_FILE",
  RENAME = "RENAME",
  CREATE_DIR = "CREATE_DIR",
  LIST_DIR = "LIST_DIR",
  DELETE_DIR = "DELETE_DIR",
  ERROR = "ERROR",
  DOWNLOAD = "DOWNLOAD",
  PROGRESS = "PROGRESS",
  LOG = "LOG",
  MOUNT = "MOUNT",
  UNMOUNT = "UNMOUNT",
}

/** Filesystem types the FFmpeg FS can mount. */
export enum FsType {
  MEMFS = "MEMFS",
  NODEFS = "NODEFS",
  NODERAWFS = "NODERAWFS",
  IDBFS = "IDBFS",
  WORKERFS = "WORKERFS",
  PROXYFS = "PROXYFS",
}

export interface FFmpegLoadConfig {
  /** Optional override for the module worker script URL. */
  classWorkerURL?: string;
  coreURL?: string;
  wasmURL?: string;
  [key: string]: unknown;
}

export type FFLog = unknown;
export type FFProgress = unknown;

interface FFMessage {
  id: number;
  type: FFMessageType;
  data: unknown;
}

type ResolveFn = (data: unknown) => void;
type RejectFn = (reason?: unknown) => void;

let messageIdCounter = 0;
function nextMessageId(): number {
  return messageIdCounter++;
}

export class FFmpeg {
  #worker: Worker | null = null;
  #resolves: Record<number, ResolveFn> = {};
  #rejects: Record<number, RejectFn> = {};
  #logHandlers: Array<(log: FFLog) => void> = [];
  #progressHandlers: Array<(progress: FFProgress) => void> = [];

  /** True after the worker has answered a LOAD message. */
  loaded = false;

  #bindWorker = (): void => {
    if (!this.#worker) return;
    this.#worker.onmessage = ({ data }: MessageEvent<FFMessage>) => {
      switch (data.type) {
        case FFMessageType.LOAD:
          this.loaded = true;
          this.#resolves[data.id]?.(data.data);
          break;
        case FFMessageType.MOUNT:
        case FFMessageType.UNMOUNT:
        case FFMessageType.EXEC:
        case FFMessageType.FFPROBE:
        case FFMessageType.WRITE_FILE:
        case FFMessageType.READ_FILE:
        case FFMessageType.DELETE_FILE:
        case FFMessageType.RENAME:
        case FFMessageType.CREATE_DIR:
        case FFMessageType.LIST_DIR:
        case FFMessageType.DELETE_DIR:
          this.#resolves[data.id]?.(data.data);
          break;
        case FFMessageType.LOG:
          for (const handler of this.#logHandlers) handler(data.data);
          break;
        case FFMessageType.PROGRESS:
          for (const handler of this.#progressHandlers) handler(data.data);
          break;
        case FFMessageType.ERROR:
          this.#rejects[data.id]?.(data.data);
          break;
        default:
          break;
      }
      delete this.#resolves[data.id];
      delete this.#rejects[data.id];
    };
  };

  #dispatch = (
    message: Omit<FFMessage, "id">,
    transferables: Transferable[] = [],
    signal?: AbortSignal,
  ): Promise<unknown> => {
    if (!this.#worker) return Promise.reject(ERROR_NOT_LOADED);
    return new Promise<unknown>((resolve, reject) => {
      const id = nextMessageId();
      this.#worker?.postMessage(
        { id, type: message.type, data: message.data },
        transferables,
      );
      this.#resolves[id] = resolve;
      this.#rejects[id] = reject;
      signal?.addEventListener(
        "abort",
        () => {
          reject(new DOMException(`Message # ${id} was aborted`, "AbortError"));
        },
        { once: true },
      );
    });
  };

  /**
   * Boots the core inside the worker. Pass `coreURL` / `wasmURL` (extension
   * URLs for `ffmpeg-core.js` / `ffmpeg-core.wasm`); everything else in
   * `config` is forwarded to the worker's LOAD handler.
   */
  load = (
    config: FFmpegLoadConfig = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> => {
    // classWorkerURL only selects the worker script; it is never forwarded.
    const { classWorkerURL, ...forwarded } = config;
    if (!this.#worker) {
      this.#worker = classWorkerURL
        ? new Worker(new URL(classWorkerURL, import.meta.url), { type: "module" })
        : new Worker(WORKER_URL, { type: "module" });
      this.#bindWorker();
    }
    return this.#dispatch(
      { type: FFMessageType.LOAD, data: forwarded },
      [],
      options.signal,
    );
  };

  exec = (
    args: string[],
    timeout = -1,
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> =>
    this.#dispatch(
      { type: FFMessageType.EXEC, data: { args, timeout } },
      [],
      options.signal,
    );

  ffprobe = (
    args: string[],
    timeout = -1,
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> =>
    this.#dispatch(
      { type: FFMessageType.FFPROBE, data: { args, timeout } },
      [],
      options.signal,
    );

  terminate = (): void => {
    for (const id of Object.keys(this.#rejects)) {
      this.#rejects[Number(id)]?.(ERROR_TERMINATED);
      delete this.#rejects[Number(id)];
      delete this.#resolves[Number(id)];
    }
    if (this.#worker) {
      this.#worker.terminate();
      this.#worker = null;
      this.loaded = false;
    }
  };

  writeFile = (
    path: string,
    data: Uint8Array | string,
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> => {
    const transferables: Transferable[] = [];
    if (data instanceof Uint8Array) transferables.push(data.buffer);
    return this.#dispatch(
      { type: FFMessageType.WRITE_FILE, data: { path, data } },
      transferables,
      options.signal,
    );
  };

  mount = (
    fsType: FsType | string,
    options: Record<string, unknown>,
    mountPoint: string,
  ): Promise<unknown> =>
    this.#dispatch({
      type: FFMessageType.MOUNT,
      data: { fsType, options, mountPoint },
    });

  unmount = (mountPoint: string): Promise<unknown> =>
    this.#dispatch({ type: FFMessageType.UNMOUNT, data: { mountPoint } });

  readFile = (
    path: string,
    encoding: string = "binary",
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> =>
    this.#dispatch(
      { type: FFMessageType.READ_FILE, data: { path, encoding } },
      [],
      options.signal,
    );

  deleteFile = (
    path: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> =>
    this.#dispatch({ type: FFMessageType.DELETE_FILE, data: { path } }, [], options.signal);

  rename = (
    oldPath: string,
    newPath: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> =>
    this.#dispatch(
      { type: FFMessageType.RENAME, data: { oldPath, newPath } },
      [],
      options.signal,
    );

  createDir = (
    path: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> =>
    this.#dispatch({ type: FFMessageType.CREATE_DIR, data: { path } }, [], options.signal);

  listDir = (
    path: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> =>
    this.#dispatch({ type: FFMessageType.LIST_DIR, data: { path } }, [], options.signal);

  deleteDir = (
    path: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> =>
    this.#dispatch({ type: FFMessageType.DELETE_DIR, data: { path } }, [], options.signal);

  on(event: "log" | "progress", callback: (data: unknown) => void): void {
    if (event === "log") this.#logHandlers.push(callback);
    else if (event === "progress") this.#progressHandlers.push(callback);
  }

  off(event: "log" | "progress", callback: (data: unknown) => void): void {
    if (event === "log")
      this.#logHandlers = this.#logHandlers.filter((h) => h !== callback);
    else if (event === "progress")
      this.#progressHandlers = this.#progressHandlers.filter((h) => h !== callback);
  }
}
