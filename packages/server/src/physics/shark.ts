import type { ActiveFish } from "@aquarium/shared";
import { PHYSICS } from "@aquarium/shared";

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
}>();

export function applyShark(fish: ActiveFish): void {
  if (!sharkState.has(fish.id)) {
    // 初回: 進行方向をランダムに設定、旋回方向もランダム
    sharkState.set(fish.id, {
      angle: Math.random() * Math.PI * 2,
      turnDir: Math.random() < 0.5 ? 1 : -1,
      frame: 0,
    });
  }
  const state = sharkState.get(fish.id)!;
  state.frame++;

  // 毎フレーム少しずつ旋回角度を変化させる（縦抑制のため、Y成分を弱める）
  state.angle += PHYSICS.SHARK_TURN_RATE * state.turnDir;

  const speed = PHYSICS.SHARK_SPEED * fish.physics.speedMultiplier;

  // 速度ベクトル計算（縦成分を抑制）
  fish.physics.vel.x = Math.cos(state.angle) * speed;
  fish.physics.vel.y = Math.sin(state.angle) * speed * PHYSICS.SHARK_VERTICAL_DAMPING;

  fish.physics.pos.x += fish.physics.vel.x;
  fish.physics.pos.y += fish.physics.vel.y;
}
