import type { ActiveFish } from "@aquarium/shared";
import { PHYSICS } from "@aquarium/shared";
import { getWorld } from "../world";
import { initDepthBehavior, updateDepthBehavior, type DepthBehaviorState } from "./depth-behavior";
import { motionProfileFor, movementScale, verticalSpreadForFish, turnStrengthForFish } from "./motion-profile";

// ============================================================
// shark.ts — サメ型: 大弧単独回遊 (相対回避・滑らかな物理)
//
// 動作原理:
//   - 常にゆっくりと一定の曲率で弧を描いて回遊する
//   - 壁や禁止エリアに近づいたときは、絶対座標（中央）を向くのをやめ、
//     壁の法線（壁から離れる方向ベクトル）を合成して回避する。
// ============================================================

const sharkState = new Map<string, {
  angle: number;     // 現在の進行方向角 (radian)
  turnDir: 1 | -1;  // 旋回方向（常に一定）
  frame: number;
  turnRate: number;
  framesUntilTurnChange: number;
  targetAngle: number;
  depth: DepthBehaviorState;
}>();

export function applyShark(fish: ActiveFish): void {
  const world = getWorld();
  if (!sharkState.has(fish.id)) {
    // 初回: 進行方向をランダムに設定、旋回方向もランダム
    sharkState.set(fish.id, {
      angle: Math.random() * Math.PI * 2,
      turnDir: Math.random() < 0.5 ? 1 : -1,
      frame: 0,
      turnRate: PHYSICS.SHARK_TURN_RATE * (0.35 + Math.random() * 0.65),
      framesUntilTurnChange: 240 + Math.floor(Math.random() * 600),
      targetAngle: Math.random() * Math.PI * 2,
      depth: initDepthBehavior(fish),
    });
  }
  const state = sharkState.get(fish.id)!;
  const profile = motionProfileFor(fish);
  state.frame++;
  state.framesUntilTurnChange--;
  if (state.framesUntilTurnChange <= 0) {
    state.turnDir = Math.random() < 0.5 ? 1 : -1;
    state.turnRate = PHYSICS.SHARK_TURN_RATE * (0.25 + Math.random() * 0.75);
    state.targetAngle = Math.random() * Math.PI * 2;
    state.framesUntilTurnChange = 300 + Math.floor(Math.random() * 700);
  }

  let targetDiff = state.targetAngle - state.angle;
  while (targetDiff > Math.PI) targetDiff -= Math.PI * 2;
  while (targetDiff < -Math.PI) targetDiff += Math.PI * 2;
  state.angle += Math.max(-state.turnRate, Math.min(state.turnRate, targetDiff * 0.015)) * turnStrengthForFish(fish);
  state.angle += state.turnRate * state.turnDir * 0.25 * turnStrengthForFish(fish);

  // --- 相対的な壁・禁止エリア回避 ---
  const margin = PHYSICS.WALL_MARGIN * 2.5;
  let avoidX = 0;
  let avoidY = 0;
  let isNearWall = false;

  if (world.horizontalBoundaryMode === "bounce") {
    if (fish.physics.pos.x < margin) {
      avoidX += (1 - fish.physics.pos.x / margin);
      isNearWall = true;
    }
    if (fish.physics.pos.x > world.width - margin) {
      avoidX -= (1 - (world.width - fish.physics.pos.x) / margin);
      isNearWall = true;
    }
  }
  if (fish.physics.pos.y < margin) {
    avoidY += (1 - fish.physics.pos.y / margin);
    isNearWall = true;
  }
  if (fish.physics.pos.y > world.height - margin) {
    avoidY -= (1 - (world.height - fish.physics.pos.y) / margin);
    isNearWall = true;
  }

  // 進入禁止エリアからの相対的回避ベクトル
  for (const fz of world.forbiddenZones) {
    const halfW = fz.width / 2 + margin;
    const halfH = fz.height / 2 + margin;
    const dx = fish.physics.pos.x - (fz.x + fz.width / 2);
    const dy = fish.physics.pos.y - (fz.y + fz.height / 2);
    if (Math.abs(dx) < halfW && Math.abs(dy) < halfH) {
      const overlapX = halfW - Math.abs(dx);
      const overlapY = halfH - Math.abs(dy);
      if (overlapX < overlapY) {
        avoidX += Math.sign(dx) * (overlapX / margin);
      } else {
        avoidY += Math.sign(dy) * (overlapY / margin);
      }
      isNearWall = true;
    }
  }

  if (isNearWall) {
    // 回避ベクトルの方向に向くように徐々に角度を合わせる
    const inwardAngle = Math.atan2(avoidY, avoidX);
    state.targetAngle = inwardAngle;
    let diff = inwardAngle - state.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    state.angle += Math.max(-0.065, Math.min(0.065, diff)) * turnStrengthForFish(fish);
  }

  const speed = PHYSICS.SHARK_SPEED * movementScale(fish) * (0.92 + Math.sin(state.frame * 0.011) * 0.08);

  // 速度ベクトル計算（縦成分を抑制）
  const targetVX = Math.cos(state.angle) * speed;
  const targetVY = Math.sin(state.angle) * speed * PHYSICS.SHARK_VERTICAL_DAMPING * verticalSpreadForFish(fish)
    + updateDepthBehavior(fish, state.depth, 0.004) * 16;
  const accel = Math.max(0.025, Math.min(0.16, 0.08 / Math.max(0.45, profile.glide)));
  fish.physics.vel.x += (targetVX - fish.physics.vel.x) * accel;
  fish.physics.vel.y += (targetVY - fish.physics.vel.y) * accel;

  fish.physics.pos.x += fish.physics.vel.x;
  fish.physics.pos.y += fish.physics.vel.y;
}
