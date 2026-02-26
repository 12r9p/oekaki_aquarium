import type { ClientConfig } from "@aquarium/shared";
import { DEFAULT_WORLD } from "@aquarium/shared";

// ============================================================
// WorldConfig: 全クライアントのViewportを統合した仮想水槽
// ============================================================

export interface WorldConfig {
  width: number;
  height: number;
  /** 接続済みクライアントが定義する「泳げるエリア」の一覧 */
  validZones: ValidZone[];
}

export interface ValidZone {
  clientUuid: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** このモニターの床Y座標 (Type C アンカー配置用) */
  floorY: number;
}

// シングルトンとして管理する仮想水槽状態
const world: WorldConfig = {
  width: DEFAULT_WORLD.width,
  height: DEFAULT_WORLD.height,
  validZones: [],
};

/**
 * クライアントが接続・設定を送信したときに ValidZone を登録/更新する。
 * 全 ValidZone の外接矩形から world サイズを動的に更新する。
 */
export function registerClientViewport(config: ClientConfig): void {
  const zone: ValidZone = {
    clientUuid: config.uuid,
    x: config.viewport.x,
    y: config.viewport.y,
    width: config.viewport.width,
    height: config.viewport.height,
    floorY: config.viewport.y + config.viewport.height,
  };

  const idx = world.validZones.findIndex((z) => z.clientUuid === config.uuid);
  if (idx >= 0) {
    world.validZones[idx] = zone;
  } else {
    world.validZones.push(zone);
  }

  // 外接矩形でworld全体サイズを再計算
  let maxX: number = DEFAULT_WORLD.width;
  let maxY: number = DEFAULT_WORLD.height;
  for (const z of world.validZones) {
    maxX = Math.max(maxX, z.x + z.width);
    maxY = Math.max(maxY, z.y + z.height);
  }
  world.width = maxX;
  world.height = maxY;
}

/** クライアントが切断したときに ValidZone を削除する */
export function unregisterClient(uuid: string): void {
  const idx = world.validZones.findIndex((z) => z.clientUuid === uuid);
  if (idx >= 0) world.validZones.splice(idx, 1);
}

/** 現在の世界設定を取得 */
export function getWorld(): Readonly<WorldConfig> {
  return world;
}

/** 与えられた座標が ValidZone 内かどうかを判定 */
export function isInValidZone(x: number, y: number): boolean {
  return world.validZones.some(
    (z) => x >= z.x && x <= z.x + z.width && y >= z.y && y <= z.y + z.height
  );
}

/** 最も近い ValidZone の中心座標を返す（Void からの押し戻し先） */
export function nearestValidZoneCenter(x: number, y: number): { x: number; y: number } {
  if (world.validZones.length === 0) {
    return { x: DEFAULT_WORLD.width / 2, y: DEFAULT_WORLD.height / 2 };
  }

  let nearest = world.validZones[0];
  let minDist = Infinity;

  for (const z of world.validZones) {
    const cx = z.x + z.width / 2;
    const cy = z.y + z.height / 2;
    const dist = Math.hypot(cx - x, cy - y);
    if (dist < minDist) {
      minDist = dist;
      nearest = z;
    }
  }

  return {
    x: nearest.x + nearest.width / 2,
    y: nearest.y + nearest.height / 2,
  };
}
