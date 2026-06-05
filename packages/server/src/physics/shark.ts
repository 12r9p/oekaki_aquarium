import type { ActiveFish } from "@aquarium/shared";
import { PHYSICS } from "@aquarium/shared";
import { getWorld } from "../world";
import { initDepthBehavior, updateDepthBehavior, type DepthBehaviorState } from "./depth-behavior";
import { motionProfileFor, movementScale, verticalSpreadForFish, turnStrengthForFish } from "./motion-profile";

// ============================================================
// shark.ts — サメ型: 大弧単独回遊 (角速度慣性による優雅な旋回)
//
// 改善点:
//   - サメの進行方向角度 `angle` の更新に「角速度の慣性モデル (angularVelocity)」を導入。
//     急激な角度変化を物理的に不可能にし、常に滑らかで大きな弧を描いて泳ぐように改善。
//   - 壁や禁止エリアの回避時も、角速度の慣性を経て緩やかに向きを変えるため、
//     衝突回避が非常に優雅になりました。
// ============================================================

const sharkState = new Map<string, {
  angle: number;            // 現在の進行方向角 (radian)
  turnDir: 1 | -1;          // 旋回方向
  frame: number;
  turnRate: number;
  framesUntilTurnChange: number;
  targetAngle: number;
  angularVelocity: number;  // 角速度 (慣性用)
  depth: DepthBehaviorState;
}>();

export function applyShark(fish: ActiveFish): void {
  const world = getWorld();
  if (!sharkState.has(fish.id)) {
    sharkState.set(fish.id, {
      angle: Math.random() * Math.PI * 2,
      turnDir: Math.random() < 0.5 ? 1 : -1,
      frame: 0,
      turnRate: PHYSICS.SHARK_TURN_RATE * (0.35 + Math.random() * 0.65),
      framesUntilTurnChange: 240 + Math.floor(Math.random() * 600),
      targetAngle: Math.random() * Math.PI * 2,
      angularVelocity: 0,
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

  // --- 相対的な壁・禁止エリア回避ベクトルの計算 ---
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
    // 壁付近では回避方向ベクトルを目標角度に設定
    state.targetAngle = Math.atan2(avoidY, avoidX);
  }

  // --- 角速度慣性モデルによる角度の更新 ---
  let targetDiff = state.targetAngle - state.angle;
  while (targetDiff > Math.PI) targetDiff -= Math.PI * 2;
  while (targetDiff < -Math.PI) targetDiff += Math.PI * 2;

  // 通常巡航による緩やかな旋回
  const normalTurn = state.turnRate * state.turnDir * 0.22;
  // 目標方向への操舵旋回
  // 壁回避時はより早く向きを変えるため、感度を高める
  const sensitivity = isNearWall ? 0.024 : 0.012;
  const steerTurn = Math.max(-state.turnRate, Math.min(state.turnRate, targetDiff * sensitivity));
  
  const desiredAngularVel = (steerTurn + normalTurn) * turnStrengthForFish(fish);

  // 前フレームの角速度を90%維持し、滑らかに加速・減衰させる (角加速度の制限)
  state.angularVelocity += (desiredAngularVel - state.angularVelocity) * 0.10;
  
  // 最大角速度を厳しく制限 (急旋回の防止)
  const maxAngVel = PHYSICS.SHARK_TURN_RATE * 1.3 * turnStrengthForFish(fish);
  state.angularVelocity = Math.max(-maxAngVel, Math.min(maxAngVel, state.angularVelocity));

  state.angle += state.angularVelocity;

  const speed = PHYSICS.SHARK_SPEED * movementScale(fish) * (0.92 + Math.sin(state.frame * 0.011) * 0.08);

  // 速度ベクトル計算（サメらしく縦成分を強く抑制）
  const targetVX = Math.cos(state.angle) * speed;
  const targetVY = Math.sin(state.angle) * speed * PHYSICS.SHARK_VERTICAL_DAMPING * 0.85 * verticalSpreadForFish(fish)
    + updateDepthBehavior(fish, state.depth, 0.004) * 16;
  const accel = Math.max(0.025, Math.min(0.16, 0.08 / Math.max(0.45, profile.glide)));
  fish.physics.vel.x += (targetVX - fish.physics.vel.x) * accel;
  fish.physics.vel.y += (targetVY - fish.physics.vel.y) * accel;

  fish.physics.pos.x += fish.physics.vel.x;
  fish.physics.pos.y += fish.physics.vel.y;
}
