import type { ActiveFish, Vector2 } from "@aquarium/shared";
import { PHYSICS } from "@aquarium/shared";
import { getWorld } from "../world";
import { maxSpeedForFish } from "./motion-profile";

// ============================================================
// 境界判定 (Boundaries)
//
// 役割:
//   1. Valid Zone内に留まるよう壁反発力を加える
//   2. Void（画面外）に侵入した場合、最近傍 ValidZone へ向けて押し戻す
//   3. エサへの引力を速度ベクトルに加算する
// ============================================================

export interface FoodItem {
  id: string;
  pos: Vector2;
  expiresAt: number;
}

/** アクティブなエサの一覧（game-loop から共有参照） */
export const foodItems: FoodItem[] = [];

export function applyBoundaries(fish: ActiveFish): void {
  const world = getWorld();
  const pos = fish.physics.pos;
  const vel = fish.physics.vel;
  const speed = maxSpeedForFish(fish);

  // --- 1. Void / 画面外 からの押し戻し (ハードクランプ + 速度反転方式) ---
  // 力ベースだと高速時に外に出たままになるので、座標を強制修正する
  const bounceDamp = 0.75;
  const wallMargin = 36; // 画面枠は36pxまで接近可能に
  if (world.horizontalBoundaryMode === "wrap") {
    if (pos.x < 0) pos.x = world.width;
    if (pos.x > world.width) pos.x = 0;
  } else {
    const minEdgeEscape = speed * 0.22;
    if (pos.x < wallMargin) {
      pos.x = wallMargin;
      if (vel.x < minEdgeEscape) vel.x = Math.max(minEdgeEscape, Math.abs(vel.x) * bounceDamp);
    }
    if (pos.x > world.width - wallMargin) {
      pos.x = world.width - wallMargin;
      if (vel.x > -minEdgeEscape) vel.x = -Math.max(minEdgeEscape, Math.abs(vel.x) * bounceDamp);
    }
  }
  if (pos.y < wallMargin) {
    pos.y = wallMargin;
    if (vel.y < 0) vel.y *= -bounceDamp;
  }
  if (pos.y > world.height - wallMargin) {
    pos.y = world.height - wallMargin;
    if (vel.y > 0) vel.y *= -bounceDamp;
  }

  // --- 2. 進入禁止エリア (Forbidden Zones) での壁反発と衝突補正 ---
  const fzMargin = 24; // 魚の半径(約24px)までギリギリ近づける
  for (const fz of world.forbiddenZones) {
    // 禁止エリアのマージン分拡張したBoundingBox内にいるか
    if (
      pos.x > fz.x - fzMargin && pos.x < fz.x + fz.width + fzMargin &&
      pos.y > fz.y - fzMargin && pos.y < fz.y + fz.height + fzMargin
    ) {
      // どの壁に近いかで反発方向と位置補正を決める
      const distL = Math.abs(pos.x - (fz.x - fzMargin));
      const distR = Math.abs(pos.x - (fz.x + fz.width + fzMargin));
      const distT = Math.abs(pos.y - (fz.y - fzMargin));
      const distB = Math.abs(pos.y - (fz.y + fz.height + fzMargin));
      
      const minDist = Math.min(distL, distR, distT, distB);

      // 強制的に位置をマージン外へクランプし、進行方向の速度を反転＆減衰させる
      // 張り付き防止のため、最低限の反発速度（キック力）を保証する
      const bounceDamping = 0.8;
      const minKick = 2.0;

      if (minDist === distL) {
        // 左壁：左へ押し戻す
        pos.x = fz.x - fzMargin;
        if (vel.x > 0) vel.x = Math.min(-minKick, vel.x * -bounceDamping);
      } else if (minDist === distR) {
        // 右壁：右へ押し戻す
        pos.x = fz.x + fz.width + fzMargin;
        if (vel.x < 0) vel.x = Math.max(minKick, vel.x * -bounceDamping);
      } else if (minDist === distT) {
        // 上壁：上へ押し戻す
        pos.y = fz.y - fzMargin;
        if (vel.y > 0) vel.y = Math.min(-minKick, vel.y * -bounceDamping);
      } else {
        // 下壁：下へ押し戻す
        pos.y = fz.y + fz.height + fzMargin;
        if (vel.y < 0) vel.y = Math.max(minKick, vel.y * -bounceDamping);
      }
    }
  }

  // 速度クランプ
  const len = Math.hypot(vel.x, vel.y);
  if (len > speed) {
    vel.x = (vel.x / len) * speed;
    vel.y = (vel.y / len) * speed;
  }

  // --- 3. エサへの引力 ---
  const now = Date.now();
  for (const food of foodItems) {
    if (food.expiresAt < now) continue;
    const dx = food.pos.x - pos.x;
    const dy = food.pos.y - pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0 && dist < PHYSICS.FOOD_RADIUS) {
      const forceMag = PHYSICS.FOOD_FORCE * (1 - dist / PHYSICS.FOOD_RADIUS);
      vel.x += (dx / dist) * forceMag;
      vel.y += (dy / dist) * forceMag;
    }
  }
}

/** 期限切れのエサを定期的に削除 */
export function cleanExpiredFood(): void {
  const now = Date.now();
  for (let i = foodItems.length - 1; i >= 0; i--) {
    if (foodItems[i].expiresAt < now) foodItems.splice(i, 1);
  }
}
