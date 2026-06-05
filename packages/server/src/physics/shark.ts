import type { ActiveFish } from "@aquarium/shared";
import { PHYSICS } from "@aquarium/shared";
import { getWorld } from "../world";
import { initDepthBehavior, updateDepthBehavior, type DepthBehaviorState } from "./depth-behavior";
import { motionProfileFor, movementScale, verticalSpreadForFish, turnStrengthForFish } from "./motion-profile";

// ============================================================
// shark.ts — サメ型: 大弧単独回遊（優雅な旋回）
//
// 動作原理:
//   - 常にゆっくりと一定の曲率で弧を描いて回遊する
//   - 弧の半径は大きく（旋回周期が長い）
//   - 縦移動を強く抑制して横移動を基本とした楕円軌道を描く
//   - 他の魚に干渉せず単独行動
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
  const margin = PHYSICS.WALL_MARGIN * 2.5;
  if (
    (world.horizontalBoundaryMode === "bounce" && fish.physics.pos.x < margin) ||
    (world.horizontalBoundaryMode === "bounce" && fish.physics.pos.x > world.width - margin) ||
    fish.physics.pos.y < margin ||
    fish.physics.pos.y > world.height - margin
  ) {
    const inwardAngle = Math.atan2(
      world.height / 2 - fish.physics.pos.y,
      world.width / 2 - fish.physics.pos.x,
    );
    state.targetAngle = inwardAngle;
    let diff = inwardAngle - state.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    state.angle += Math.max(-0.055, Math.min(0.055, diff)) * turnStrengthForFish(fish);
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
