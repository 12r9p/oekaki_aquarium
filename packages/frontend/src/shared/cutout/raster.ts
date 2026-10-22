// ============================================================
// shared/cutout/raster.ts
// 切り抜き処理で使う、DOM に依存しない画素・マスク操作
// ============================================================

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA 順、1画素4バイト */
  data: Uint8ClampedArray;
}

/** 1画素1バイトの 0/1 マスク */
export type Mask = Uint8Array;

/** 画素ごとの明るさ（RGB平均）と色味の差（RGBの最大−最小）。gains は RGB ごとの補正倍率。 */
export function brightnessAndSpread(
  image: RgbaImage,
  gains: readonly [number, number, number] = [1, 1, 1],
): { brightness: Uint8Array; spread: Uint8Array } {
  const n = image.width * image.height;
  const brightness = new Uint8Array(n);
  const spread = new Uint8Array(n);
  const d = image.data;
  const [gr, gg, gb] = gains;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const r = Math.min(255, d[i]! * gr);
    const g = Math.min(255, d[i + 1]! * gg);
    const b = Math.min(255, d[i + 2]! * gb);
    brightness[p] = (r + g + b) / 3;
    spread[p] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  return { brightness, spread };
}

/** 不透明でない画素が全体の ratio 以上あるか（切り抜き済みPNGの判定用） */
export function hasTransparency(image: RgbaImage, ratio = 0.01): boolean {
  const n = image.width * image.height;
  let count = 0;
  for (let i = 3; i < image.data.length; i += 4) {
    if (image.data[i]! < 250) count++;
  }
  return count >= n * ratio;
}

/** 値の並びの q 分位点（0..1）。values は 0..255 の整数。 */
export function percentileOf(values: ArrayLike<number>, q: number, include: (index: number) => boolean): number {
  const histogram = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    if (!include(i)) continue;
    histogram[values[i]!]!++;
    total++;
  }
  if (total === 0) return 0;
  const target = total * q;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += histogram[v]!;
    if (seen >= target) return v;
  }
  return 255;
}

/** 4近傍でつながった領域ごとに番号を振る。0 は対象外、1 以降が領域番号。areas[label] がその面積。 */
export function labelComponents(mask: Mask, width: number, height: number): { labels: Int32Array; areas: number[] } {
  const n = width * height;
  const labels = new Int32Array(n);
  const areas: number[] = [0];
  const queue = new Int32Array(n);
  let next = 1;
  for (let start = 0; start < n; start++) {
    if (!mask[start] || labels[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = next;
    while (head < tail) {
      const p = queue[head++]!;
      const x = p % width;
      if (x > 0 && mask[p - 1] && !labels[p - 1]) { labels[p - 1] = next; queue[tail++] = p - 1; }
      if (x < width - 1 && mask[p + 1] && !labels[p + 1]) { labels[p + 1] = next; queue[tail++] = p + 1; }
      if (p >= width && mask[p - width] && !labels[p - width]) { labels[p - width] = next; queue[tail++] = p - width; }
      if (p < n - width && mask[p + width] && !labels[p + width]) { labels[p + width] = next; queue[tail++] = p + width; }
    }
    areas.push(tail);
    next++;
  }
  return { labels, areas };
}

/** passable が 1 の画素のうち、seeds から4近傍でたどれる画素を 1 にしたマスク */
export function floodFrom(seeds: Mask, passable: Mask, width: number, height: number): Mask {
  const n = width * height;
  const reached = new Uint8Array(n);
  const queue = new Int32Array(n);
  let tail = 0;
  for (let p = 0; p < n; p++) {
    if (seeds[p] && passable[p]) { reached[p] = 1; queue[tail++] = p; }
  }
  let head = 0;
  while (head < tail) {
    const p = queue[head++]!;
    const x = p % width;
    if (x > 0 && passable[p - 1] && !reached[p - 1]) { reached[p - 1] = 1; queue[tail++] = p - 1; }
    if (x < width - 1 && passable[p + 1] && !reached[p + 1]) { reached[p + 1] = 1; queue[tail++] = p + 1; }
    if (p >= width && passable[p - width] && !reached[p - width]) { reached[p - width] = 1; queue[tail++] = p - width; }
    if (p < n - width && passable[p + width] && !reached[p + width]) { reached[p + width] = 1; queue[tail++] = p + width; }
  }
  return reached;
}

/** 画像の外周1画素を 1 にしたマスク */
export function imageBorder(width: number, height: number): Mask {
  const border = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    border[x] = 1;
    border[(height - 1) * width + x] = 1;
  }
  for (let y = 0; y < height; y++) {
    border[y * width] = 1;
    border[y * width + width - 1] = 1;
  }
  return border;
}

/**
 * 正方形 (2r+1)×(2r+1) の膨張（grow=true）または収縮（grow=false）。画像外の画素は参照しない。
 * 窓の中の「探している値」の個数を横・縦の順に数え、半径によらず画素数に比例する時間で処理する。
 */
function morph(mask: Mask, width: number, height: number, radius: number, grow: boolean): Mask {
  const target = grow ? 1 : 0;
  const hit = grow ? 1 : 0;
  const horizontal = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let count = 0;
    for (let k = 0; k <= Math.min(width - 1, radius); k++) if (mask[row + k] === target) count++;
    for (let x = 0; x < width; x++) {
      horizontal[row + x] = count > 0 ? hit : 1 - hit;
      const leaving = x - radius;
      const entering = x + radius + 1;
      if (leaving >= 0 && mask[row + leaving] === target) count--;
      if (entering < width && mask[row + entering] === target) count++;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let k = 0; k <= Math.min(height - 1, radius); k++) if (horizontal[k * width + x] === hit) count++;
    for (let y = 0; y < height; y++) {
      out[y * width + x] = count > 0 ? hit : 1 - hit;
      const leaving = y - radius;
      const entering = y + radius + 1;
      if (leaving >= 0 && horizontal[leaving * width + x] === hit) count--;
      if (entering < height && horizontal[entering * width + x] === hit) count++;
    }
  }
  return out;
}

export function dilate(mask: Mask, width: number, height: number, radius: number): Mask {
  return morph(mask, width, height, radius, true);
}

export function erode(mask: Mask, width: number, height: number, radius: number): Mask {
  return morph(mask, width, height, radius, false);
}

/** 3×3 平均でマスクの縁をぼかし、0..255 の不透明度にする */
export function featherToAlpha(mask: Mask, width: number, height: number): Uint8ClampedArray {
  const alpha = new Uint8ClampedArray(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          sum += mask[yy * width + xx]!;
          count++;
        }
      }
      alpha[y * width + x] = Math.round((sum / count) * 255);
    }
  }
  return alpha;
}
