import { CanvasSource, Texture } from "pixi.js";

interface TextureRecord {
  texture?: Texture;
  loading?: Promise<Texture>;
  failures: number;
  retryAt: number;
}

const records = new Map<string, TextureRecord>();
const BASE_RETRY_MS = 1_000;
const MAX_RETRY_MS = 10_000;
const MAX_CONCURRENT_LOADS = 6;
let activeLoads = 0;
const loadQueue: Array<() => void> = [];

function runNext(): void {
  while (activeLoads < MAX_CONCURRENT_LOADS && loadQueue.length > 0) {
    activeLoads++;
    loadQueue.shift()!();
  }
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    loadQueue.push(() => {
      void task()
        .then(resolve, reject)
        .finally(() => {
          activeLoads--;
          runNext();
        });
    });
    runNext();
  });
}

function retryUrl(url: string, failures: number): string {
  if (failures === 0) return url;
  const parsed = new URL(url, window.location.href);
  parsed.searchParams.set("_fish_retry", String(failures));
  return parsed.href;
}

function loadTexture(url: string): Promise<Texture> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    const timeout = window.setTimeout(() => {
      image.src = "";
      reject(new Error(`Fish texture load timed out: ${url}`));
    }, 8_000);

    image.onload = () => {
      window.clearTimeout(timeout);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error(`Canvas context unavailable for fish texture: ${url}`));
        return;
      }
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      const source = new CanvasSource({ resource: canvas });
      resolve(new Texture({ source, label: url }));
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error(`Failed to load fish texture: ${url}`));
    };
    image.src = url;
  });
}

/**
 * 失敗時は別URLとして再試行し、Pixiの失敗キャッシュに固定されるのを防ぐ。
 * 同じURLの同時ロードは1つにまとめる。
 */
export function requestFishTexture(url: string): Promise<Texture> {
  const record = records.get(url) ?? { failures: 0, retryAt: 0 };
  records.set(url, record);

  if (record.texture) return Promise.resolve(record.texture);
  if (record.loading) return record.loading;
  if (Date.now() < record.retryAt) {
    return Promise.reject(new Error(`Fish texture retry pending: ${url}`));
  }

  const requestUrl = retryUrl(url, record.failures);
  record.loading = enqueue(() => loadTexture(requestUrl))
    .then((texture) => {
      texture.label = url;
      record.texture = texture;
      record.failures = 0;
      record.retryAt = 0;
      return texture;
    })
    .catch((error) => {
      record.failures++;
      record.retryAt = Date.now() + Math.min(
        MAX_RETRY_MS,
        BASE_RETRY_MS * 2 ** Math.min(record.failures - 1, 4),
      );
      throw error;
    })
    .finally(() => {
      record.loading = undefined;
    });

  return record.loading;
}

export function getLoadedFishTexture(url: string): Texture | undefined {
  return records.get(url)?.texture;
}
