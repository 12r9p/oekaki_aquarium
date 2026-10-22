// ============================================================
// shared/cutout/cutout.ts
// 紙に描かれた絵を写真から切り抜く（DOM 非依存・決定的）
//
// 1. 写真の中から紙を見つける（paper.ts）
// 2. 紙の場所ごとの明るさより暗い画素、または色の付いた画素を「描線・塗り」とする
// 3. 紙の縁から描線以外の画素をたどり、届いた範囲を背景にする
// 4. 届かなかった範囲を絵として残す。輪郭に囲まれた白い部分（目など）も絵に含まれる
// ============================================================

import { estimateWhiteGains, findPaper, paperBrightnessMap } from "./paper";
import {
  brightnessAndSpread,
  dilate,
  erode,
  featherToAlpha,
  floodFrom,
  hasTransparency,
  imageBorder,
  labelComponents,
  percentileOf,
  type Mask,
  type RgbaImage,
} from "./raster";

/** 紙の明るさに対してこの比率より暗い画素を描線・塗りとする */
const INK_BRIGHTNESS_RATIO = 0.86;
/** 紙の色味の差（90%点）にこの値を足した値より色の濃い画素を塗りとする */
const INK_SPREAD_MARGIN = 24;
/** 紙の縁から内側のこの幅（長辺に対する比率）は、紙の影や縁の写り込みとして絵に含めない */
const SHEET_EDGE_RATIO = 0.015;
/** 紙の明るさに対してこの比率より暗い画素は、影ではなくはっきりした描線とみなす */
const STRONG_INK_RATIO = 0.6;
/** 領域のうち、はっきりした描線・色の付いた塗りがこの比率未満なら、影として取り除く */
const STRONG_INK_MIN_SHARE = 0.02;
/** 影とみなす最小の太さ（長辺に対する比率）。これより細い薄い線は鉛筆の線として残す。 */
const SHADOW_MIN_THICKNESS_RATIO = 0.008;
/** 最大の絵の領域に対してこの比率より小さい領域は、汚れとして取り除く */
const SPECK_RATIO = 0.03;
/** 絵として扱う最小の面積（画像全体に対する比率） */
const DRAWING_MIN_AREA_RATIO = 0.002;
/** 切り抜いた絵の周りに残す透明な余白（画素） */
const TRIM_PADDING = 2;

export type CutoutResult =
  | { kind: "cut"; image: RgbaImage }
  | { kind: "skipped"; reason: "transparent" | "no-paper" | "no-drawing" };

export function cutOutDrawing(image: RgbaImage): CutoutResult {
  const { width, height } = image;
  const n = width * height;
  if (hasTransparency(image)) return { kind: "skipped", reason: "transparent" };

  // 照明の色かぶりを打ち消した値で判定する。出力する絵の色は元の写真のまま。
  const { brightness, spread } = brightnessAndSpread(image, estimateWhiteGains(image));
  const region = findPaper(brightness, spread, width, height);
  if (!region) return { kind: "skipped", reason: "no-paper" };
  const { paper, sheet } = region;

  const paperLevel = paperBrightnessMap(brightness, paper, width, height);
  const paperSpread = percentileOf(spread, 0.9, (p) => paper[p] === 1);
  const ink = new Uint8Array(n);
  const strongInk = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (!sheet[p]) continue;
    const darker = brightness[p]! < paperLevel[p]! * INK_BRIGHTNESS_RATIO;
    const colored = spread[p]! > paperSpread + INK_SPREAD_MARGIN;
    ink[p] = darker || colored ? 1 : 0;
    strongInk[p] = colored || brightness[p]! < paperLevel[p]! * STRONG_INK_RATIO ? 1 : 0;
  }

  // 描線の小さな切れ目から内側へたどり込まないよう、描線を一度太らせてから細らせる（クロージング）。
  const longSide = Math.max(width, height);
  const closeRadius = Math.max(1, Math.round(longSide / 800));
  const walls = erode(dilate(ink, width, height, closeRadius), width, height, closeRadius);

  // 紙の縁付近の、描線でない画素からたどり始める。紙が画面いっぱいの場合は画像の端を紙の縁とする。
  const edgeBand = Math.max(2, Math.round(longSide * SHEET_EDGE_RATIO));
  const framedSheet = sheet.slice();
  const frame = imageBorder(width, height);
  for (let p = 0; p < n; p++) if (frame[p]) framedSheet[p] = 0;
  const sheetInner = erode(framedSheet, width, height, edgeBand);
  const seeds = new Uint8Array(n);
  const passable = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    passable[p] = sheet[p] && !walls[p] ? 1 : 0;
    seeds[p] = sheet[p] && !sheetInner[p] ? 1 : 0;
  }
  const background = floodFrom(seeds, passable, width, height);

  const drawing = new Uint8Array(n);
  const outside = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    drawing[p] = sheetInner[p] && !background[p] ? 1 : 0;
    outside[p] = drawing[p] ? 0 : 1;
  }
  const withoutShadows = removeOutsideShadows(drawing, strongInk, outside, width, height, closeRadius);
  const cleaned = removeSpecks(withoutShadows, strongInk, width, height);
  if (!cleaned) return { kind: "skipped", reason: "no-drawing" };

  return { kind: "cut", image: trimToMask(image, cleaned) };
}

/**
 * 紙の外側から絵にかかった影を取り除く。
 * はっきりした描線・塗りを含まず、ある程度の太さがあり、外側に接している部分を影とみなす。
 * 輪郭に囲まれた白い部分（目など）は外側に接しないため、鉛筆の細い線は太さがないため残る。
 */
function removeOutsideShadows(drawing: Mask, strongInk: Mask, outside: Mask, width: number, height: number, closeRadius: number): Mask {
  const n = width * height;
  const strongWalls = erode(dilate(strongInk, width, height, closeRadius), width, height, closeRadius);
  const weak = new Uint8Array(n);
  for (let p = 0; p < n; p++) weak[p] = drawing[p] && !strongWalls[p] ? 1 : 0;

  const thickness = Math.max(2, Math.round(Math.max(width, height) * SHADOW_MIN_THICKNESS_RATIO));
  const thickWeak = dilate(erode(weak, width, height, thickness), width, height, thickness);
  const touchingOutside = dilate(outside, width, height, 1);
  const seeds = new Uint8Array(n);
  for (let p = 0; p < n; p++) seeds[p] = thickWeak[p] && touchingOutside[p] ? 1 : 0;
  // 影の縁に残る細い取り残しも消えるよう、影の範囲を少し広げてから取り除く。
  const shadow = dilate(floodFrom(seeds, thickWeak, width, height), width, height, 1);

  const out = new Uint8Array(n);
  for (let p = 0; p < n; p++) out[p] = drawing[p] && !(shadow[p] && weak[p]) ? 1 : 0;
  return out;
}

/**
 * 影と汚れを取り除く。はっきりした描線・塗りをほとんど含まない領域は影、
 * 最大の絵の領域に比べて小さい領域は汚れとみなす。絵が小さすぎる場合は null。
 */
function removeSpecks(mask: Mask, strongInk: Mask, width: number, height: number): Mask | null {
  const { labels, areas } = labelComponents(mask, width, height);
  const strongCounts = new Array<number>(areas.length).fill(0);
  for (let p = 0; p < mask.length; p++) {
    if (labels[p] && strongInk[p]) strongCounts[labels[p]!]!++;
  }
  const isDrawing = areas.map((area, label) => label > 0 && strongCounts[label]! >= Math.max(1, area * STRONG_INK_MIN_SHARE));
  const largestArea = areas.reduce((max, area, label) => (isDrawing[label] ? Math.max(max, area) : max), 0);
  if (largestArea < width * height * DRAWING_MIN_AREA_RATIO) return null;
  const keep = areas.map((area, label) => isDrawing[label]! && area >= largestArea * SPECK_RATIO);
  const out = new Uint8Array(mask.length);
  for (let p = 0; p < mask.length; p++) out[p] = keep[labels[p]!] ? 1 : 0;
  return out;
}

/** マスクの範囲で画像を切り出し、縁をぼかした不透明度を付ける */
function trimToMask(image: RgbaImage, mask: Mask): RgbaImage {
  const { width, height } = image;
  const alpha = featherToAlpha(mask, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!alpha[y * width + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  minX = Math.max(0, minX - TRIM_PADDING);
  minY = Math.max(0, minY - TRIM_PADDING);
  maxX = Math.min(width - 1, maxX + TRIM_PADDING);
  maxY = Math.min(height - 1, maxY + TRIM_PADDING);

  const outWidth = maxX - minX + 1;
  const outHeight = maxY - minY + 1;
  const data = new Uint8ClampedArray(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const src = (minY + y) * width + (minX + x);
      const dst = (y * outWidth + x) * 4;
      data[dst] = image.data[src * 4]!;
      data[dst + 1] = image.data[src * 4 + 1]!;
      data[dst + 2] = image.data[src * 4 + 2]!;
      data[dst + 3] = alpha[src]!;
    }
  }
  return { width: outWidth, height: outHeight, data };
}
