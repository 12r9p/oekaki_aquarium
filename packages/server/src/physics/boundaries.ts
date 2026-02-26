import type { ActiveFish, Vector2 } from "@aquarium/shared";
import { PHYSICS } from "@aquarium/shared";
import { getWorld, isInValidZone, nearestValidZoneCenter } from "../world";

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
  const speed = PHYSICS.BOIDS_MAX_SPEED * fish.physics.speedMultiplier;

  // --- 1. Void / 画面外 からの押し戻し ---
  // 修正: まず水槽全体 (world.width x world.height) の境界で壁反発を行う
  if (pos.x < PHYSICS.WALL_MARGIN) {
    vel.x += PHYSICS.WALL_FORCE;
  }
  if (pos.x > world.width - PHYSICS.WALL_MARGIN) {
    vel.x -= PHYSICS.WALL_FORCE;
  }
  if (pos.y < PHYSICS.WALL_MARGIN) {
    vel.y += PHYSICS.WALL_FORCE;
  }
  if (pos.y > world.height - PHYSICS.WALL_MARGIN) {
    vel.y -= PHYSICS.WALL_FORCE;
  }

  // --- 2. 進入禁止エリア (Forbidden Zones) での壁反発 ---
  for (const fz of world.forbiddenZones) {
    // 禁止エリアのマージン分拡張したBoundingBox内にいるか
    if (
      pos.x > fz.x - PHYSICS.WALL_MARGIN && pos.x < fz.x + fz.width + PHYSICS.WALL_MARGIN &&
      pos.y > fz.y - PHYSICS.WALL_MARGIN && pos.y < fz.y + fz.height + PHYSICS.WALL_MARGIN
    ) {
      // どの壁に近いかで反発方向を決める
      const distL = Math.abs(pos.x - fz.x);
      const distR = Math.abs(pos.x - (fz.x + fz.width));
      const distT = Math.abs(pos.y - fz.y);
      const distB = Math.abs(pos.y - (fz.y + fz.height));
      const minDist = Math.min(distL, distR, distT, distB);

      if (minDist === distL) vel.x -= PHYSICS.WALL_FORCE * 1.5; // 左壁：左へ押し戻す
      else if (minDist === distR) vel.x += PHYSICS.WALL_FORCE * 1.5; // 右壁：右へ押し戻す
      else if (minDist === distT) vel.y -= PHYSICS.WALL_FORCE * 1.5; // 上壁：上へ押し戻す
      else vel.y += PHYSICS.WALL_FORCE * 1.5; // 下壁：下へ押し戻す
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
