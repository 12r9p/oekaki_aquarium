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

  // --- 1. Void からの押し戻し ---
  if (!isInValidZone(pos.x, pos.y) && world.validZones.length > 0) {
    const center = nearestValidZoneCenter(pos.x, pos.y);
    const dx = center.x - pos.x;
    const dy = center.y - pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0) {
      vel.x += (dx / dist) * PHYSICS.WALL_FORCE * 2;
      vel.y += (dy / dist) * PHYSICS.WALL_FORCE * 2;
    }
    return; // Void 内では壁反発以外の計算をスキップ
  }

  // --- 2. 各 ValidZone の壁反発 ---
  for (const zone of world.validZones) {
    if (
      pos.x < zone.x || pos.x > zone.x + zone.width ||
      pos.y < zone.y || pos.y > zone.y + zone.height
    ) continue;

    // 左壁
    if (pos.x - zone.x < PHYSICS.WALL_MARGIN) {
      vel.x += PHYSICS.WALL_FORCE;
    }
    // 右壁
    if (zone.x + zone.width - pos.x < PHYSICS.WALL_MARGIN) {
      vel.x -= PHYSICS.WALL_FORCE;
    }
    // 上壁
    if (pos.y - zone.y < PHYSICS.WALL_MARGIN) {
      vel.y += PHYSICS.WALL_FORCE;
    }
    // 下壁（床）
    if (zone.floorY - pos.y < PHYSICS.WALL_MARGIN) {
      vel.y -= PHYSICS.WALL_FORCE;
    }
    break;
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
