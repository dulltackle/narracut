import {
  useCallback,
  useEffect,
  useState,
  type RefCallback,
} from "react";

const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_MAX_CACHE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_CACHE_ENTRIES = 256;

export type VideoThumbnailState = {
  status: "idle" | "loading" | "ready" | "error";
  url?: string;
};

type Entry = {
  path: string;
  state: VideoThumbnailState;
  bytes: number;
  lastUsed: number;
  listeners: Set<(state: VideoThumbnailState) => void>;
};

export type VideoThumbnailLoaderOptions = {
  fetchImpl?: typeof fetch;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  maxConcurrent?: number;
  maxCacheBytes?: number;
  maxCacheEntries?: number;
};

export class VideoThumbnailLoader {
  readonly #fetch: typeof fetch;
  readonly #createObjectUrl: (blob: Blob) => string;
  readonly #revokeObjectUrl: (url: string) => void;
  readonly #maxConcurrent: number;
  readonly #maxCacheBytes: number;
  readonly #maxCacheEntries: number;
  readonly #entries = new Map<string, Entry>();
  readonly #queued = new Set<string>();
  readonly #queue: string[] = [];
  #active = 0;
  #cacheBytes = 0;
  #clock = 0;

  constructor({
    fetchImpl = (...args) => fetch(...args),
    createObjectUrl = (blob) => URL.createObjectURL(blob),
    revokeObjectUrl = (url) => URL.revokeObjectURL(url),
    maxConcurrent = DEFAULT_MAX_CONCURRENT,
    maxCacheBytes = DEFAULT_MAX_CACHE_BYTES,
    maxCacheEntries = DEFAULT_MAX_CACHE_ENTRIES,
  }: VideoThumbnailLoaderOptions = {}) {
    this.#fetch = fetchImpl;
    this.#createObjectUrl = createObjectUrl;
    this.#revokeObjectUrl = revokeObjectUrl;
    this.#maxConcurrent = maxConcurrent;
    this.#maxCacheBytes = maxCacheBytes;
    this.#maxCacheEntries = maxCacheEntries;
  }

  subscribe(
    path: string,
    listener: (state: VideoThumbnailState) => void,
  ): () => void {
    const entry = this.#entry(path);
    entry.listeners.add(listener);
    entry.lastUsed = ++this.#clock;
    listener(entry.state);
    return () => {
      entry.listeners.delete(listener);
      entry.lastUsed = ++this.#clock;
      this.#evict();
    };
  }

  load(path: string): void {
    const entry = this.#entry(path);
    entry.lastUsed = ++this.#clock;
    if (entry.state.status !== "idle" || this.#queued.has(path)) return;
    entry.state = { status: "loading" };
    this.#queued.add(path);
    this.#queue.push(path);
    this.#notify(entry);
    this.#drain();
  }

  dispose(): void {
    for (const entry of this.#entries.values()) {
      if (entry.state.url !== undefined) this.#revokeObjectUrl(entry.state.url);
    }
    this.#entries.clear();
    this.#queue.length = 0;
    this.#queued.clear();
    this.#cacheBytes = 0;
  }

  #entry(path: string): Entry {
    const existing = this.#entries.get(path);
    if (existing !== undefined) return existing;
    const entry: Entry = {
      path,
      state: { status: "idle" },
      bytes: 0,
      lastUsed: ++this.#clock,
      listeners: new Set(),
    };
    this.#entries.set(path, entry);
    return entry;
  }

  #drain(): void {
    while (this.#active < this.#maxConcurrent) {
      const path = this.#queue.shift();
      if (path === undefined) return;
      this.#queued.delete(path);
      const entry = this.#entries.get(path);
      if (entry === undefined) continue;
      this.#active += 1;
      void this.#load(entry).finally(() => {
        this.#active -= 1;
        this.#drain();
      });
    }
  }

  async #load(entry: Entry): Promise<void> {
    try {
      const query = new URLSearchParams({ path: entry.path });
      const response = await this.#fetch(`/api/assets/thumbnail?${query}`);
      if (!response.ok) throw new Error("无法生成视频首帧。");
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().startsWith("image/jpeg")) {
        throw new Error("视频首帧响应格式无效。");
      }
      const blob = await response.blob();
      const url = this.#createObjectUrl(blob);
      if (entry.state.url !== undefined) this.#revokeObjectUrl(entry.state.url);
      this.#cacheBytes -= entry.bytes;
      entry.bytes = blob.size;
      this.#cacheBytes += entry.bytes;
      entry.state = { status: "ready", url };
    } catch {
      entry.state = { status: "error" };
    }
    entry.lastUsed = ++this.#clock;
    this.#notify(entry);
    this.#evict();
  }

  #notify(entry: Entry): void {
    for (const listener of entry.listeners) listener(entry.state);
  }

  #evict(): void {
    while (
      this.#entries.size > this.#maxCacheEntries ||
      this.#cacheBytes > this.#maxCacheBytes
    ) {
      const candidate = [...this.#entries.values()]
        .filter((entry) => entry.listeners.size === 0 && entry.state.status !== "loading")
        .sort((left, right) => left.lastUsed - right.lastUsed)[0];
      if (candidate === undefined) return;
      this.#entries.delete(candidate.path);
      this.#cacheBytes -= candidate.bytes;
      if (candidate.state.url !== undefined) this.#revokeObjectUrl(candidate.state.url);
    }
  }
}

const videoThumbnailLoader = new VideoThumbnailLoader();

export function useVideoThumbnail(
  path: string | undefined,
  enabled: boolean,
): VideoThumbnailState & { ref: RefCallback<HTMLSpanElement> } {
  const [element, setElement] = useState<HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<VideoThumbnailState>({ status: "idle" });
  const ref = useCallback<RefCallback<HTMLSpanElement>>((node) => setElement(node), []);

  useEffect(() => {
    setVisible(false);
    if (!enabled || element === null) return;
    const isCurrentlyVisible = () => {
      const bounds = element.getBoundingClientRect();
      const scrollRoot = element.closest(".table-wrap");
      const rootBounds = scrollRoot?.getBoundingClientRect() ?? {
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        left: 0,
      };
      return (
        bounds.width > 0 &&
        bounds.height > 0 &&
        bounds.right > Math.max(0, rootBounds.left) &&
        bounds.left < Math.min(window.innerWidth, rootBounds.right) &&
        bounds.bottom > Math.max(0, rootBounds.top) &&
        bounds.top < Math.min(window.innerHeight, rootBounds.bottom)
      );
    };
    if (isCurrentlyVisible()) {
      setVisible(true);
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisible(true);
      observer.disconnect();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, enabled, path]);

  useEffect(() => {
    if (path === undefined) {
      setState({ status: "idle" });
      return;
    }
    return videoThumbnailLoader.subscribe(path, setState);
  }, [path]);

  useEffect(() => {
    if (enabled && visible && path !== undefined) videoThumbnailLoader.load(path);
  }, [enabled, path, visible]);

  return { ...state, ref };
}
