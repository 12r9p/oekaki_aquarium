import type { ClientConfig, AppLayerConfig } from "@aquarium/shared";

// ============================================================
// display/state.ts
// Displayアプリ全体のグローバルステート管理
// ============================================================

const params = new URLSearchParams(location.search);

function getDisplayId(): string {
  const fromUrl = params.get("id");
  if (fromUrl) {
    sessionStorage.setItem("display-id", fromUrl);
    return fromUrl;
  }
  const saved = sessionStorage.getItem("display-id");
  if (saved) return saved;
  const newId = `tab-${crypto.randomUUID().slice(0, 8)}`;
  sessionStorage.setItem("display-id", newId);
  return newId;
}

export const DISPLAY_ID = getDisplayId();

export const STATE = {
  // 初期Viewport (後方互換でURLパラメータも読む)
  VP: {
    x: parseInt(params.get("vx") ?? "0"),
    y: parseInt(params.get("vy") ?? "0"),
    width: parseInt(params.get("vw") ?? String(window.screen.width)),
    height: parseInt(params.get("vh") ?? String(window.screen.height)),
    scale: parseFloat(params.get("scale") ?? "1"),
  } as NonNullable<ClientConfig["viewport"]>,

  // 物理画面への動的スケール
  scaleX: 1,
  scaleY: 1,

  // URLから取得するワールドサイズ (worldmap用)
  WORLD_W: parseInt(params.get("worldW") ?? "4000"),
  WORLD_H: parseInt(params.get("worldH") ?? "2000"),
  layers: [] as AppLayerConfig[],
};

export function updateStateVP(newVp: NonNullable<ClientConfig["viewport"]>) {
  STATE.VP = { ...newVp };
  STATE.scaleX = window.innerWidth / STATE.VP.width;
  STATE.scaleY = window.innerHeight / STATE.VP.height;
}

export function viewportForCurrentWindow(): NonNullable<ClientConfig["viewport"]> {
  const scale = Number.isFinite(STATE.VP.scale) && STATE.VP.scale > 0 ? STATE.VP.scale : 1;
  return {
    ...STATE.VP,
    width: Math.max(1, Math.round(window.innerWidth / scale)),
    height: Math.max(1, Math.round(window.innerHeight / scale)),
  };
}

export function updateWorldSize(w: number, h: number) {
  STATE.WORLD_W = w;
  STATE.WORLD_H = h;
}

export function updateLayers(layers: AppLayerConfig[]) {
  STATE.layers = [...layers];
}
