import { create } from "zustand";
import type {
  ActiveFish,
  AppLayerConfig,
  DisplayClientInfo,
  PendingFish,
  TestPattern,
  WsServerMessage,
} from "@aquarium/shared";
import { createWsClient } from "../shared/useWs";

// ============================================================
// Zustand Store for a single source of truth
// ============================================================

export const ws = createWsClient("manage");

interface ManageState {
  // --- Core State ---
  displays: DisplayClientInfo[];
  activeFish: ActiveFish[];
  pendingFish: PendingFish[];
  worldW: number;
  worldH: number;
  bgUrl: string;
  forbiddenZones: { id: string; x: number; y: number; width: number; height: number }[];
  spawnPoints: { id: string; x: number; y: number }[];
  layers: AppLayerConfig[];
  connected: boolean;
  lastError: string | null;
  lastFrame: any | null;

  // --- UI State ---
  tab: "layout" | "fish" | "pending";
  setTab: (tab: "layout" | "fish" | "pending") => void;

  // --- Actions ---
  connectWs: () => void;
  fetchState: () => Promise<void>;
  setLastError: (error: string | null) => void;
  
  // --- Server Actions ---
  sendTestPattern: (pattern: TestPattern, targetUuid?: string) => Promise<void>;
  saveViewport: (uuid: string, vp: NonNullable<DisplayClientInfo["viewport"]>) => Promise<void>;
  updateWorldSize: (w: number, h: number) => void;
  updateWorldConfig: (config: { bgUrl?: string; forbiddenZones?: any[]; spawnPoints?: any[], layers?: any[] }) => void;
  addDemoFish: (preset?: "swimmer" | "looper" | "anchor") => Promise<void>;
  moveFish: (fishId: string, x: number, y: number) => Promise<void>;
}

export const useManageStore = create<ManageState>((set, get) => ({
  // --- Core State ---
  displays: [],
  activeFish: [],
  pendingFish: [],
  worldW: 3840,
  worldH: 1080,
  bgUrl: "",
  forbiddenZones: [],
  spawnPoints: [],
  layers: [],
  connected: false,
  lastError: null,
  lastFrame: null,

  // --- UI State ---
  tab: "layout",
  setTab: (tab) => set({ tab }),

  // --- Actions ---
  setLastError: (error) => set({ lastError: error }),

  connectWs: () => {
    // WebSocketの接続状態をストアに反映
    setInterval(() => {
      if (get().connected !== ws.connected) {
        set({ connected: ws.connected });
      }
    }, 500);

    // WebSocketメッセージのハンドリング
    ws.onMessage((msg: WsServerMessage) => {
      switch (msg.event) {
        case "state_push":
          set({
            displays: msg.clients.filter((c) => c.clientType === "display"),
            worldW: msg.worldW ?? get().worldW,
            worldH: msg.worldH ?? get().worldH,
            bgUrl: msg.bgUrl ?? get().bgUrl,
            forbiddenZones: msg.forbiddenZones ?? get().forbiddenZones,
            spawnPoints: msg.spawnPoints ?? get().spawnPoints,
            layers: msg.layers ?? get().layers,
          });
          break;
        case "update_world_config":
           set({
            bgUrl: msg.bgUrl ?? get().bgUrl,
            forbiddenZones: msg.forbiddenZones ?? get().forbiddenZones,
            spawnPoints: msg.spawnPoints ?? get().spawnPoints,
            layers: msg.layers ?? get().layers,
          });
          break;
        case "fish_list":
          set({
            activeFish: msg.activeFish,
            pendingFish: msg.pendingFish,
          });
          break;
        case "update_world_size":
           set({
            worldW: msg.width,
            worldH: msg.height,
          });
          break;
        case "frame":
          // windowオブジェクトではなく、ストアの状態として保持
          set({ lastFrame: msg });
          break;
      }
    });
  },

  fetchState: async () => {
    try {
      const res = await fetch("/api/state");
      if (!res.ok) throw new Error("Server returned an error");
      const data = await res.json();
      set({
        displays: data.clients.filter((c: any) => c.clientType === "display"),
        activeFish: data.activeFish,
        pendingFish: data.pendingFish,
        worldW: data.worldW ?? get().worldW,
        worldH: data.worldH ?? get().worldH,
        bgUrl: data.bgUrl ?? get().bgUrl,
        forbiddenZones: data.forbiddenZones ?? get().forbiddenZones,
        spawnPoints: data.spawnPoints ?? get().spawnPoints,
        layers: data.layers ?? get().layers,
      });
    } catch (err) {
      console.error("Polling error:", err);
      get().setLastError("サーバーとの接続に問題があります。");
      setTimeout(() => get().setLastError(null), 5000);
    }
  },

  // --- Server Actions ---
  sendTestPattern: async (pattern, targetUuid) => {
    // TODO: showAlertをストアに移管する
    await fetch("/api/clients/test-pattern", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern, targetUuid }),
    });
  },

  saveViewport: async (uuid, vp) => {
    await fetch(`/api/clients/${encodeURIComponent(uuid)}/viewport`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vp),
    });
  },

  updateWorldSize: (w, h) => {
    set({ worldW: w, worldH: h });
    if (get().connected) {
      // @ts-ignore
      ws.send({ event: "update_world_size", width: w, height: h });
    }
  },
  
  updateWorldConfig: (config) => {
    const currentState = get();
    const newState = {
      bgUrl: config.bgUrl ?? currentState.bgUrl,
      forbiddenZones: config.forbiddenZones ?? currentState.forbiddenZones,
      spawnPoints: config.spawnPoints ?? currentState.spawnPoints,
      layers: config.layers ?? currentState.layers,
    };
    set(newState);
     if (get().connected) {
      // @ts-ignore
      ws.send({ event: "update_world_config", ...newState });
    }
  },

  addDemoFish: async (preset = "swimmer") => {
    const demos = ["🐟", "🐠", "🐡", "🐙", "🦑", "🦐", "🦈", "🐬", "🐋"];
    const emj = demos[Math.floor(Math.random() * demos.length)];
    const canvas = document.createElement("canvas");
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
        ctx.clearRect(0, 0, 128, 128);
        ctx.font = '96px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(emj, 64, 72);
    }
    const dataUrl = canvas.toDataURL("image/png");
    try {
        const res = await fetch("/api/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: dataUrl })
        });
        const data = await res.json() as { fish: { id: string; imageUrl: string } };
        await fetch("/api/release", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id: data.fish.id,
                type: preset,
                textureUrl: data.fish.imageUrl,
                userParams: { scale: 1.0, speed: preset === "looper" ? 2.0 : 1.0, rotationOffset: 0 }
            })
        });
        void get().fetchState();
    } catch (e) {
      console.error(e);
    }
  },

  moveFish: async (fishId, x, y) => {
    await fetch(`/api/fish/${encodeURIComponent(fishId)}/position`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x, y }),
    });
  },
}));
