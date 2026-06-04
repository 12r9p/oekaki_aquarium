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
  if (world.horizontalBoundaryMode === "wrap") {
    if (pos.x < -PHYSICS.WALL_MARGIN) pos.x = world.width + PHYSICS.WALL_MARGIN;
    if (pos.x > world.width + PHYSICS.WALL_MARGIN) pos.x = -PHYSICS.WALL_MARGIN;
  } else {
    if (pos.x < PHYSICS.WALL_MARGIN) {
      pos.x = PHYSICS.WALL_MARGIN;
      if (vel.x < 0) vel.x *= -bounceDamp;
    }
    if (pos.x > world.width - PHYSICS.WALL_MARGIN) {
      pos.x = world.width - PHYSICS.WALL_MARGIN;
      if (vel.x > 0) vel.x *= -bounceDamp;
    }
  }
  if (pos.y < PHYSICS.WALL_MARGIN) {
    pos.y = PHYSICS.WALL_MARGIN;
    if (vel.y < 0) vel.y *= -bounceDamp;
  }
  if (pos.y > world.height - PHYSICS.WALL_MARGIN) {
    pos.y = world.height - PHYSICS.WALL_MARGIN;
    if (vel.y > 0) vel.y *= -bounceDamp;
  }

  // --- 2. 進入禁止エリア (Forbidden Zones) での壁反発と衝突補正 ---
  for (const fz of world.forbiddenZones) {
    const margin = PHYSICS.WALL_MARGIN;
    // 禁止エリアのマージン分拡張したBoundingBox内にいるか
    if (
      pos.x > fz.x - margin && pos.x < fz.x + fz.width + margin &&
      pos.y > fz.y - margin && pos.y < fz.y + fz.height + margin
    ) {
      // どの壁に近いかで反発方向と位置補正を決める
      const distL = Math.abs(pos.x - (fz.x - margin));
      const distR = Math.abs(pos.x - (fz.x + fz.width + margin));
      const distT = Math.abs(pos.y - (fz.y - margin));
      const distB = Math.abs(pos.y - (fz.y + fz.height + margin));
      
      const minDist = Math.min(distL, distR, distT, distB);

      // 強制的に位置をマージン外へクランプし、進行方向の速度を反転＆減衰させる
      // 張り付き防止のため、最低限の反発速度（キック力）を保証する
      const bounceDamping = 0.8;
      const minKick = 2.0;

      if (minDist === distL) {
        // 左壁：左へ押し戻す
        pos.x = fz.x - margin;
        if (vel.x > 0) vel.x = Math.min(-minKick, vel.x * -bounceDamping);
      } else if (minDist === distR) {
        // 右壁：右へ押し戻す
        pos.x = fz.x + fz.width + margin;
        if (vel.x < 0) vel.x = Math.max(minKick, vel.x * -bounceDamping);
      } else if (minDist === distT) {
        // 上壁：上へ押し戻す
        pos.y = fz.y - margin;
        if (vel.y > 0) vel.y = Math.min(-minKick, vel.y * -bounceDamping);
      } else {
        // 下壁：下へ押し戻す
        pos.y = fz.y + fz.height + margin;
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
