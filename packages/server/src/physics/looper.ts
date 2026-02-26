import type { ActiveFish } from "@aquarium/shared";

// ============================================================
// Looper (Type B): 手書きモーションパスのループ再生
//
// 動作原理:
//   - 潮流による全体移動 (Global X) + 手書き軌跡のオフセット (Local X, Y)
//   - motionPath の点を一定速度で循環参照し、ローカル座標として加算する
//   - グローバル X は右方向へ緩やかに流れ、端に達したら逆サイドから再出現
// ============================================================

/** 各クラゲのループ再生状態（IDインデックスで管理） */
const loopState = new Map<string, { pathIdx: number; subStep: number }>();

const LOOP_GLOBAL_SPEED = 0.4; // 潮流の基本速度 (px/frame)
const PATH_STEP_SPEED = 2;     // パス上を1ステップ進むのに何フレーム使うか

export function applyLooper(fish: ActiveFish, worldWidth: number): void {
  if (!fish.motionPath || fish.motionPath.length < 2) {
    // パスがない場合は右へ緩やかに流れるだけ
    fish.physics.pos.x += LOOP_GLOBAL_SPEED * fish.physics.speedMultiplier;
    if (fish.physics.pos.x > worldWidth + 200) {
      fish.physics.pos.x = -200;
    }
    return;
  }

  // ループ状態の初期化
  if (!loopState.has(fish.id)) {
    loopState.set(fish.id, { pathIdx: 0, subStep: 0 });
  }
  const state = loopState.get(fish.id)!;

  // 1. 潮流によるグローバル移動
  fish.physics.pos.x += LOOP_GLOBAL_SPEED * fish.physics.speedMultiplier;
  if (fish.physics.pos.x > worldWidth + 200) {
    fish.physics.pos.x = -200;
  }

  // 2. ローカルモーションパスのオフセット計算
  //    パスの現在点と次の点を線形補間してスプライト位置に加算する
  state.subStep++;
  if (state.subStep >= PATH_STEP_SPEED) {
    state.subStep = 0;
    state.pathIdx = (state.pathIdx + 1) % fish.motionPath.length;
  }

  const cur = fish.motionPath[state.pathIdx];
  const next = fish.motionPath[(state.pathIdx + 1) % fish.motionPath.length];
  const t = state.subStep / PATH_STEP_SPEED;

  // ローカルオフセットをグローバル座標として加算する
  // （本来は親座標を基準とする相対座標だが、シンプル実装として直接加算）
  fish.physics.vel.x = LOOP_GLOBAL_SPEED + (next.x - cur.x) * t * fish.physics.speedMultiplier;
  fish.physics.vel.y = (next.y - cur.y) * t * fish.physics.speedMultiplier;
  fish.physics.pos.y += fish.physics.vel.y;
}
