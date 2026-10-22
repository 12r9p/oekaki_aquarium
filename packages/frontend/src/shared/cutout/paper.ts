// ============================================================
// shared/cutout/paper.ts
// 写真の中から紙を見つけ、紙の場所ごとの明るさを推定する
// ============================================================

import { floodFrom, imageBorder, labelComponents, percentileOf, type Mask, type RgbaImage } from "./raster";

/** 紙とみなす色味の差の上限。床・机・椅子などの色付きの背景を除く。 */
const PAPER_MAX_SPREAD = 30;
/** 周囲の無彩色の明るさに対する比率。これ以上明るければ紙の候補にする。 */
const PAPER_LOCAL_RATIO = 0.82;
/** 写真全体の無彩色の明るさに対する比率。影で暗くなった紙もこの比率までは紙の候補にする。 */
const PAPER_GLOBAL_RATIO = 0.5;
/** 紙として扱う最小の面積（画像全体に対する比率） */
const PAPER_MIN_AREA_RATIO = 0.03;
/** 画像の外周のうち紙が占める比率がこれ以上なら、紙が画面いっぱいに写っているとみなす */
const PAPER_FILLS_FRAME_RATIO = 0.6;
/** 色かぶりの補正倍率の上限 */
const MAX_WHITE_GAIN = 2;

/**
 * 照明の色かぶりを打ち消す RGB ごとの倍率を求める。
 * 写真の明るい側（上位10%）は多くの場合に紙なので、その平均色が白になる倍率を返す。
 */
export function estimateWhiteGains(image: RgbaImage): [number, number, number] {
  const n = image.width * image.height;
  const brightness = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    brightness[p] = (image.data[i]! + image.data[i + 1]! + image.data[i + 2]!) / 3;
  }
  const threshold = percentileOf(brightness, 0.9, () => true);
  const sum = [0, 0, 0];
  let count = 0;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (brightness[p]! < threshold) continue;
    sum[0] += image.data[i]!;
    sum[1] += image.data[i + 1]!;
    sum[2] += image.data[i + 2]!;
    count++;
  }
  if (count === 0) return [1, 1, 1];
  const mean = sum.map((s) => Math.max(1, s / count));
  const top = Math.max(...mean);
  const gain = (m: number) => Math.min(MAX_WHITE_GAIN, top / m);
  return [gain(mean[0]!), gain(mean[1]!), gain(mean[2]!)];
}

export interface PaperRegion {
  /** 紙の色をした画素のうち、最大の連結領域 */
  paper: Mask;
  /** paper と、その内側に囲まれた画素（絵の部分）を合わせた紙全体 */
  sheet: Mask;
}

export function findPaper(brightness: Uint8Array, spread: Uint8Array, width: number, height: number): PaperRegion | null {
  const n = width * height;
  const neutral = new Uint8Array(n);
  for (let p = 0; p < n; p++) neutral[p] = spread[p]! < PAPER_MAX_SPREAD ? 1 : 0;

  // 照明のむらで紙の明るさは場所によって変わるため、周囲の無彩色の明るさと比べて判定する。
  // 格子は紙の一部が必ず入る程度に大きくし、無彩色の画素が少ない格子（絵の塗りや床の上）は周りから補う。
  const cell = Math.max(32, Math.round(Math.max(width, height) / 8));
  const level = localLevelMap(brightness, neutral, width, height, cell, 0.95, (cell * cell) / 4);
  const globalTop = percentileOf(brightness, 0.95, (p) => neutral[p] === 1);
  const minBrightness = Math.max(60, globalTop * PAPER_GLOBAL_RATIO);

  const candidate = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    candidate[p] = neutral[p] && brightness[p]! >= minBrightness && brightness[p]! >= level[p]! * PAPER_LOCAL_RATIO ? 1 : 0;
  }

  const { labels, areas } = labelComponents(candidate, width, height);
  let largest = 0;
  for (let label = 1; label < areas.length; label++) {
    if (areas[label]! > (areas[largest] ?? 0)) largest = label;
  }
  if (largest === 0 || areas[largest]! < n * PAPER_MIN_AREA_RATIO) return null;

  const paper = new Uint8Array(n);
  for (let p = 0; p < n; p++) paper[p] = labels[p] === largest ? 1 : 0;

  // 紙が画面いっぱいに写っている場合、紙の外側はない。画像の縁で切れた絵を紙の外側と誤らないよう、画像全体を紙全体とする。
  const border = imageBorder(width, height);
  let borderPixels = 0;
  let borderPaper = 0;
  for (let p = 0; p < n; p++) {
    if (!border[p]) continue;
    borderPixels++;
    if (paper[p]) borderPaper++;
  }
  if (borderPaper >= borderPixels * PAPER_FILLS_FRAME_RATIO) {
    return { paper, sheet: new Uint8Array(n).fill(1) };
  }

  // 紙以外の画素を画像の縁からたどる。届かなかった画素は紙に囲まれた絵なので、紙全体に含める。
  const notPaper = new Uint8Array(n);
  for (let p = 0; p < n; p++) notPaper[p] = paper[p] ? 0 : 1;
  const outside = floodFrom(border, notPaper, width, height);
  const sheet = new Uint8Array(n);
  for (let p = 0; p < n; p++) sheet[p] = outside[p] ? 0 : 1;

  return { paper, sheet };
}

/**
 * 紙の場所ごとの明るさを推定する。
 * 細かい格子ごとに紙の画素の明るさ（しわや汚れに引っ張られないよう90%点）を集め、画素ごとに補間する。
 */
export function paperBrightnessMap(brightness: Uint8Array, paper: Mask, width: number, height: number): Float32Array {
  const cell = Math.max(16, Math.round(Math.max(width, height) / 40));
  return localLevelMap(brightness, paper, width, height, cell, 0.9, (cell * cell) / 8);
}

/**
 * mask の画素の values を格子ごとに集計し、q 分位点を画素ごとに双線形補間した値を返す。
 * 対象の画素が minSamples 未満の格子は、周囲の格子の値で埋める。
 */
function localLevelMap(
  values: Uint8Array,
  mask: Mask,
  width: number,
  height: number,
  cell: number,
  q: number,
  minSamples: number,
): Float32Array {
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);

  const histograms = new Uint32Array(cols * rows * 256);
  const counts = new Uint32Array(cols * rows);
  for (let y = 0; y < height; y++) {
    const cy = Math.floor(y / cell);
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!mask[p]) continue;
      const c = cy * cols + Math.floor(x / cell);
      histograms[c * 256 + values[p]!]!++;
      counts[c]!++;
    }
  }

  const grid = new Float32Array(cols * rows).fill(Number.NaN);
  for (let c = 0; c < cols * rows; c++) {
    if (counts[c]! < minSamples) continue;
    const target = counts[c]! * q;
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += histograms[c * 256 + v]!;
      if (seen >= target) { grid[c] = v; break; }
    }
  }
  fillEmptyCells(grid, cols, rows);

  const map = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const gy = Math.min(Math.max((y + 0.5) / cell - 0.5, 0), rows - 1);
    const y0 = Math.floor(gy);
    const y1 = Math.min(y0 + 1, rows - 1);
    const ty = gy - y0;
    for (let x = 0; x < width; x++) {
      const gx = Math.min(Math.max((x + 0.5) / cell - 0.5, 0), cols - 1);
      const x0 = Math.floor(gx);
      const x1 = Math.min(x0 + 1, cols - 1);
      const tx = gx - x0;
      const top = grid[y0 * cols + x0]! * (1 - tx) + grid[y0 * cols + x1]! * tx;
      const bottom = grid[y1 * cols + x0]! * (1 - tx) + grid[y1 * cols + x1]! * tx;
      map[y * width + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return map;
}

/** 値のない格子（NaN）を、値のある周囲8格子の平均で外側から順に埋める */
function fillEmptyCells(grid: Float32Array, cols: number, rows: number): void {
  for (let pass = 0; pass < cols + rows; pass++) {
    const previous = grid.slice();
    let remaining = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (!Number.isNaN(previous[i]!)) continue;
        let sum = 0;
        let count = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
            const v = previous[rr * cols + cc]!;
            if (!Number.isNaN(v)) { sum += v; count++; }
          }
        }
        if (count > 0) grid[i] = sum / count;
        else remaining++;
      }
    }
    if (remaining === 0) return;
  }
  // 対象の画素が1つもない場合だけここに来る。白で埋めて処理を続ける。
  for (let i = 0; i < grid.length; i++) if (Number.isNaN(grid[i]!)) grid[i] = 255;
}
