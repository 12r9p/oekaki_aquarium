import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { WsServerMessage, DisplayClientInfo, TestPattern, ActiveFish, PendingFish, AppLayerConfig, HorizontalBoundaryMode } from "@aquarium/shared";
import { createWsClient } from "../shared/useWs";
import "../styles/global.css";

// コンポーネント群をimport
import { Sidebar } from "./components/Sidebar";
import { ViewportCanvas } from "./components/ViewportCanvas";
import { Toolbar } from "./components/Toolbar";
import { FishTab } from "./components/FishTab";
import { PendingTab } from "./components/PendingTab";
// ============================================================
// manage/main.tsx — SaaS グレード管理画面
// ============================================================

export const ws = createWsClient("manage");

function ManageApp(): React.ReactElement {
    const [tab, setTab] = useState<"layout" | "fish" | "pending">("layout");
    const [worldW, setWorldW] = useState(3840);
    const [worldH, setWorldH] = useState(1080);
    const [displays, setDisplays] = useState<DisplayClientInfo[]>([]);
    const [activeFish, setActiveFish] = useState<ActiveFish[]>([]);
    const [pendingFish, setPendingFish] = useState<PendingFish[]>([]);
    // 背景画像URL、進入禁止エリア、放流ポイント、レイヤー管理
    const [bgUrl, setBgUrl] = useState<string>("");
    const [forbiddenZones, setForbiddenZones] = useState<{ id: string; x: number; y: number; width: number; height: number }[]>([]);
    const [spawnPoints, setSpawnPoints] = useState<{ id: string; x: number; y: number }[]>([]);
    const [layers, setLayers] = useState<AppLayerConfig[]>([]);
    const [horizontalBoundaryMode, setHorizontalBoundaryMode] = useState<HorizontalBoundaryMode>("wrap");
    const [fishSpeedMultiplier, setFishSpeedMultiplier] = useState(1);
    const [connected, setConnected] = useState(false);
    const [alert, setAlert] = useState<string | null>(null);
    const [lastError, setLastError] = useState<string | null>(null);

    // 新規追加機能: 送信レート設定
    const [sendRateSetting, setSendRateSetting] = useState(33); // プレビュー送信等のレート(ms), 30fps程度;

    const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
    const toastIdCounter = useRef(0);
    // 全魚削除の確認モード
    const [confirmAllFishDelete, setConfirmAllFishDelete] = useState(false);

    const showAlert = (msg: string): void => {
        const id = toastIdCounter.current++;
        setToasts((prev) => [...prev, { id, msg }]);
        setTimeout(() => removeToast(id), 2500);
    };

    const removeToast = (id: number) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    };

    useEffect(() => {
        const t = setInterval(() => setConnected(ws.connected), 500);
        return () => clearInterval(t);
    }, []);

    // WS からリアルタイムで接続クライアントリストを受け取る
    useEffect(() => {
        return ws.onMessage((msg: WsServerMessage) => {
            if (msg.event === "client_list") {
                setDisplays(msg.clients.filter((c) => c.clientType === "display"));
            } else if (msg.event === "state_push") {
                setDisplays(msg.clients.filter((c) => c.clientType === "display"));
                if (msg.worldW !== undefined && msg.worldH !== undefined) {
                    setWorldW(msg.worldW);
                    setWorldH(msg.worldH);
                }
                if (msg.bgUrl !== undefined) setBgUrl(msg.bgUrl);
                if (msg.forbiddenZones !== undefined) setForbiddenZones(msg.forbiddenZones);
                if (msg.spawnPoints !== undefined) setSpawnPoints(msg.spawnPoints);
                if (msg.layers !== undefined) setLayers(msg.layers);
                if (msg.horizontalBoundaryMode !== undefined) setHorizontalBoundaryMode(msg.horizontalBoundaryMode);
                if (msg.fishSpeedMultiplier !== undefined) setFishSpeedMultiplier(msg.fishSpeedMultiplier);
            } else if (msg.event === "update_world_config") {
                if (msg.bgUrl !== undefined) setBgUrl(msg.bgUrl);
                if (msg.forbiddenZones !== undefined) setForbiddenZones(msg.forbiddenZones);
                if (msg.spawnPoints !== undefined) setSpawnPoints(msg.spawnPoints);
                if (msg.layers !== undefined) setLayers(msg.layers);
                if (msg.horizontalBoundaryMode !== undefined) setHorizontalBoundaryMode(msg.horizontalBoundaryMode);
                if (msg.fishSpeedMultiplier !== undefined) setFishSpeedMultiplier(msg.fishSpeedMultiplier);
            } else if (msg.event === "fish_list") {
                setActiveFish(msg.activeFish);
                setPendingFish(msg.pendingFish);
            } else if (msg.event === "update_world_size") {
                setWorldW(msg.width);
                setWorldH(msg.height);
            } else if (msg.event === "frame") {
                // ViewportCanvas のリアルタイム描画用に window に保持
                (window as any).__lastFrame = msg;
                window.dispatchEvent(new Event("aquarium_frame"));
            }
        });
    }, []);


    // 定期ポーリング（バックアップ）
    const poll = useCallback(async () => {
        try {
            const res = await fetch("/api/state");
            const data = await res.json() as {
                clients: DisplayClientInfo[];
                activeFish: ActiveFish[];
                pendingFish: PendingFish[];
                worldW?: number;
                worldH?: number;
                bgUrl?: string;
                forbiddenZones?: { id: string; x: number; y: number; width: number; height: number }[];
                spawnPoints?: { id: string; x: number; y: number }[];
                layers?: AppLayerConfig[];
                horizontalBoundaryMode?: HorizontalBoundaryMode;
                fishSpeedMultiplier?: number;
            };
            setDisplays(data.clients.filter((c) => c.clientType === "display"));
            setActiveFish(data.activeFish);
            setPendingFish(data.pendingFish);
            if (data.worldW) setWorldW(data.worldW);
            if (data.worldH) setWorldH(data.worldH);
            if (data.bgUrl !== undefined) setBgUrl(data.bgUrl);
            if (data.forbiddenZones !== undefined) setForbiddenZones(data.forbiddenZones);
            if (data.spawnPoints !== undefined) setSpawnPoints(data.spawnPoints);
            if (data.layers !== undefined) setLayers(data.layers);
            if (data.horizontalBoundaryMode !== undefined) setHorizontalBoundaryMode(data.horizontalBoundaryMode);
            if (data.fishSpeedMultiplier !== undefined) setFishSpeedMultiplier(data.fishSpeedMultiplier);
        } catch (err) {
            console.error("Polling error:", err);
            setLastError("サーバーとの接続に問題があります。");
            setTimeout(() => setLastError(null), 5000);
        }
    }, []);

    useEffect(() => {
        void poll();
        const t = setInterval(() => void poll(), 5_000);
        return () => clearInterval(t);
    }, [poll]);

    const sendTestPattern = async (pattern: TestPattern, targetUuid?: string): Promise<void> => {
        await fetch("/api/clients/test-pattern", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pattern, targetUuid }),
        });
        showAlert(`テストパターン「${pattern}」を送信しました`);
    };

    const saveViewport = async (uuid: string, vp: DisplayClientInfo["viewport"]): Promise<void> => {
        if (!vp) return;
        const res = await fetch(`/api/clients/${encodeURIComponent(uuid)}/viewport`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(vp),
        });
        showAlert(res.ok ? "✅ Viewport を更新しました" : "❌ 更新失敗");
    };

    const removeAllFish = async (): Promise<void> => {
        setConfirmAllFishDelete(false);
        await fetch("/api/fish/all", { method: "DELETE" });
        void poll();
        showAlert("全ての魚を削除しました");
    };

    const addDemoFish = async (preset: "swimmer" | "looper" | "anchor" = "swimmer"): Promise<void> => {
        // デモ用の魚（絵文字）を投下
        const demos = ["🐟", "🐠", "🐡", "🐙", "🦑", "🦐", "🦈", "🐬", "🐋"];
        const emj = demos[Math.floor(Math.random() * demos.length)];

        // 絵文字をCanvasに描画してDataURL化
        const canvas = document.createElement("canvas");
        canvas.width = 128; canvas.height = 128;
        const ctx = canvas.getContext("2d");
        if (ctx) {
            ctx.clearRect(0, 0, 128, 128); // 透過背景
            // ブラウザの絵文字フォントを指定
            ctx.font = '96px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            // macOSなどでのズレを補正するため少しY座標を下げる
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
            // 放流APIを叩く (FishConfig 形式)
            await fetch("/api/release", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: data.fish.id,
                    type: preset,
                    textureUrl: data.fish.imageUrl,
                    userParams: {
                        scale: 1.0,
                        speed: preset === "looper" ? 2.0 : 1.0,
                        rotationOffset: 0
                    }
                })
            });
            showAlert(`デモ魚 ${emj} を追加しました`);
            void poll();
        } catch (e) {
            showAlert("デモ魚追加エラー");
        }
    };

    // LayoutTab の状態管理
    const [selectedDisplay, setSelectedDisplay] = useState<string | null>(null);
    const [activeLayerId, setActiveLayerId] = useState<string | undefined>(undefined);
    const [arLocked, setArLocked] = useState(true);
    const displaysRef = useRef<DisplayClientInfo[]>([]);
    const pendingViewports = useRef<Map<string, NonNullable<DisplayClientInfo["viewport"]>>>(new Map());
    const hoveredDisplayRef = useRef<string | null>(null);
    const setHoveredUI = useCallback((id: string | null) => { }, []); // (省略)ホバー時のSidebar同期用など

    // Undo/Redo ref
    const undoStackRef = useRef<any[]>([]);
    const redoStackRef = useRef<any[]>([]);
    const snapshotViewports = useCallback(() => {
        return displaysRef.current.filter(d => d.viewport !== null).map(d => ({ uuid: d.uuid, viewport: { ...d.viewport! } }));
    }, []);

    useEffect(() => {
        displaysRef.current = displays.map(d => {
            const pending = pendingViewports.current.get(d.uuid);
            return pending ? { ...d, viewport: pending } : { ...d, viewport: d.viewport ? { ...d.viewport } : null };
        });
    }, [displays]);

    const layoutTabState = {
        displays, activeFish, pendingFish, sendRateSetting, setSendRateSetting,
        worldW, setWorldW, worldH, setWorldH,
        bgUrl, setBgUrl, forbiddenZones, setForbiddenZones, spawnPoints, setSpawnPoints,
        layers, setLayers, horizontalBoundaryMode, setHorizontalBoundaryMode, fishSpeedMultiplier, setFishSpeedMultiplier,
        selectedDisplay, setSelectedDisplay, activeLayerId, setActiveLayerId, arLocked, setArLocked,
        displaysRef, pendingViewports, hoveredDisplayRef, setHoveredUI,
        undoStackRef, redoStackRef, snapshotViewports,
    };

    return (
        <div className="flex flex-col h-screen w-full bg-slate-50 overflow-hidden font-sans text-slate-800">
            {alert && <div className="manage-toast">{alert}</div>}

            <Toolbar
                displays={displays} activeFish={activeFish} pendingFish={pendingFish}
                connected={connected} tab={tab} setTab={setTab}
            />

            <main className="flex flex-1 overflow-hidden relative">
                {tab === "layout" && (
                    <LayoutTab
                        state={layoutTabState}
                        connected={connected}
                        onAddDemoFish={addDemoFish}
                        onSaveViewport={saveViewport}
                        onTestPattern={sendTestPattern}
                        onUpdateWorldSize={(w, h) => {
                            if (connected) {
                                // @ts-ignore
                                ws.send({ event: "update_world_size", width: w, height: h });
                            }
                        }}
                    />
                )}
                {tab === "fish" && (
                    <FishTab activeFish={activeFish} onRefresh={poll} />
                )}
                {tab === "pending" && (
                    <PendingTab pendingFish={pendingFish} onRefresh={poll} />
                )}
            </main>

            {/* ---------- トースト＆デバッグ ---------- */}
            <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
                {toasts.map(t => (
                    <div key={t.id} className="bg-sky-500 text-white px-4 py-2 rounded shadow-lg text-sm font-bold flex items-center justify-between pointer-events-auto">
                        {t.msg}
                        <button className="ml-4 opacity-70 hover:opacity-100" onClick={() => removeToast(t.id)}>×</button>
                    </div>
                ))}
            </div>
            {lastError && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-500 text-white px-6 py-3 rounded shadow-xl font-bold">
                    {lastError}
                </div>
            )}
        </div>
    );
}

interface LayoutTabProps {
    state: {
        displays: DisplayClientInfo[];
        activeFish: ActiveFish[];
        pendingFish: PendingFish[];
        sendRateSetting: number;
        setSendRateSetting: React.Dispatch<React.SetStateAction<number>>;
        worldW: number;
        setWorldW: React.Dispatch<React.SetStateAction<number>>;
        worldH: number;
        setWorldH: React.Dispatch<React.SetStateAction<number>>;
        bgUrl: string;
        setBgUrl: React.Dispatch<React.SetStateAction<string>>;
        forbiddenZones: { id: string; x: number; y: number; width: number; height: number }[];
        setForbiddenZones: React.Dispatch<React.SetStateAction<{ id: string; x: number; y: number; width: number; height: number }[]>>;
        spawnPoints: { id: string; x: number; y: number }[];
        setSpawnPoints: React.Dispatch<React.SetStateAction<{ id: string; x: number; y: number }[]>>;
        layers: AppLayerConfig[];
        setLayers: React.Dispatch<React.SetStateAction<AppLayerConfig[]>>;
        horizontalBoundaryMode: HorizontalBoundaryMode;
        setHorizontalBoundaryMode: React.Dispatch<React.SetStateAction<HorizontalBoundaryMode>>;
        fishSpeedMultiplier: number;
        setFishSpeedMultiplier: React.Dispatch<React.SetStateAction<number>>;
        selectedDisplay: string | null;
        setSelectedDisplay: React.Dispatch<React.SetStateAction<string | null>>;
        activeLayerId?: string;
        setActiveLayerId: React.Dispatch<React.SetStateAction<string | undefined>>;
        arLocked: boolean;
        setArLocked: React.Dispatch<React.SetStateAction<boolean>>;
        displaysRef: React.MutableRefObject<DisplayClientInfo[]>;
        pendingViewports: React.MutableRefObject<Map<string, NonNullable<DisplayClientInfo["viewport"]>>>;
        hoveredDisplayRef: React.MutableRefObject<string | null>;
        setHoveredUI: (id: string | null) => void;
        undoStackRef: React.MutableRefObject<any[]>;
        redoStackRef: React.MutableRefObject<any[]>;
        snapshotViewports: () => { uuid: string; viewport: NonNullable<DisplayClientInfo["viewport"]> }[];
    };
    connected: boolean;
    onAddDemoFish: () => void;
    onSaveViewport: (uuid: string, vp: NonNullable<DisplayClientInfo["viewport"]>) => Promise<void>;
    onTestPattern: (pattern: TestPattern, uuid?: string) => Promise<void>;
    onUpdateWorldSize: (w: number, h: number) => void;
}

// ====== タブ 1: レイアウト管理 ======
function LayoutTab({ state, connected, onAddDemoFish, onSaveViewport, onTestPattern, onUpdateWorldSize }: LayoutTabProps) {
    const { displays, sendRateSetting, setSendRateSetting, worldW, setWorldW, worldH, setWorldH,
        bgUrl, setBgUrl, forbiddenZones, setForbiddenZones, spawnPoints, setSpawnPoints, layers, setLayers,
        horizontalBoundaryMode, setHorizontalBoundaryMode, fishSpeedMultiplier, setFishSpeedMultiplier,
        selectedDisplay, setSelectedDisplay, activeLayerId, setActiveLayerId, arLocked, setArLocked,
        displaysRef, pendingViewports, hoveredDisplayRef, setHoveredUI,
        undoStackRef, redoStackRef, snapshotViewports } = state;

    const updateWorldConfig = (patch: {
        bgUrl?: string;
        forbiddenZones?: typeof forbiddenZones;
        spawnPoints?: typeof spawnPoints;
        layers?: AppLayerConfig[];
        horizontalBoundaryMode?: HorizontalBoundaryMode;
        fishSpeedMultiplier?: number;
    }) => {
        const next = { bgUrl, forbiddenZones, spawnPoints, layers, horizontalBoundaryMode, fishSpeedMultiplier, ...patch };
        if (connected) ws.send({ event: "update_world_config", ...next });
    };

    const onUpdateBgUrl = (url: string) => {
        setBgUrl(url);
        updateWorldConfig({ bgUrl: url });
    };

    const onUpdateForbiddenZones = (zones: { id: string; x: number; y: number; width: number; height: number }[]) => {
        setForbiddenZones(zones);
        updateWorldConfig({ forbiddenZones: zones });
    };

    const onUpdateSpawnPoints = (points: { id: string; x: number; y: number }[]) => {
        setSpawnPoints(points);
        updateWorldConfig({ spawnPoints: points });
    };

    const onUpdateLayers = (newLayers: AppLayerConfig[]) => {
        setLayers(newLayers);
        updateWorldConfig({ layers: newLayers });
    };

    return (
        <div className="flex flex-col h-full w-full">
            <div className="flex flex-1 overflow-hidden relative">
                {/* ---------- Right: Sidebar Properties ---------- */}
                <Sidebar
                    displays={displays}
                    selectedDisplayIds={selectedDisplay ? [selectedDisplay] : []}
                    onTestPattern={onTestPattern}
                    worldW={worldW}
                    worldH={worldH}
                    onAddDemoFish={onAddDemoFish}
                    onSaveViewport={onSaveViewport}
                    sendRateSetting={sendRateSetting}
                    setSendRateSetting={setSendRateSetting}
                    onUpdateWorldSize={onUpdateWorldSize}
                    bgUrl={bgUrl}
                    onUpdateBgUrl={onUpdateBgUrl}
                    forbiddenZones={forbiddenZones}
                    onUpdateForbiddenZones={onUpdateForbiddenZones}
                    spawnPoints={spawnPoints}
                    onUpdateSpawnPoints={onUpdateSpawnPoints}
                    layers={layers}
                    onUpdateLayers={onUpdateLayers}
                    horizontalBoundaryMode={horizontalBoundaryMode}
                    onUpdateHorizontalBoundaryMode={(mode) => {
                        setHorizontalBoundaryMode(mode);
                        updateWorldConfig({ horizontalBoundaryMode: mode });
                    }}
                    fishSpeedMultiplier={fishSpeedMultiplier}
                    onUpdateFishSpeedMultiplier={(speed) => {
                        setFishSpeedMultiplier(speed);
                        updateWorldConfig({ fishSpeedMultiplier: speed });
                    }}
                    activeLayerId={activeLayerId}
                    onSetActiveLayerId={setActiveLayerId}
                />
                {/* ---------- Left: Viewport Canvas ---------- */}
                <ViewportCanvas
                    worldW={worldW} worldH={worldH}
                    setWorldSize={(w, h) => {
                        setWorldW(w); setWorldH(h);
                        onUpdateWorldSize(w, h);
                    }}
                    displaysSt={displays}
                    displaysRef={displaysRef}
                    pendingViewports={pendingViewports}
                    selected={selectedDisplay}
                    setSelected={setSelectedDisplay}
                    hoveredRef={hoveredDisplayRef}
                    setHoveredUI={setHoveredUI}
                    undoStackRef={undoStackRef}
                    redoStackRef={redoStackRef}
                    snapshotViewports={snapshotViewports}
                    onSaveViewport={onSaveViewport}
                    arLocked={arLocked}
                    sendRateSetting={sendRateSetting}
                    forbiddenZones={forbiddenZones}
                    onUpdateForbiddenZones={onUpdateForbiddenZones}
                    spawnPoints={spawnPoints}
                    onUpdateSpawnPoints={onUpdateSpawnPoints}
                    layers={layers}
                    onUpdateLayers={onUpdateLayers}
                    activeLayerId={activeLayerId}
                    activeFish={state.activeFish}
                    onMoveFish={async (fishId, x, y) => {
                        await fetch(`/api/fish/${encodeURIComponent(fishId)}/position`, {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ x, y }),
                        });
                    }}
                />
            </div>

            <div className="flex items-center justify-between p-2 bg-gray-700 text-white text-sm">
                <div className="flex gap-2">
                    <label className="flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" checked={arLocked} onChange={e => setArLocked(e.target.checked)} className="form-checkbox text-blue-500" />
                        AR固定 (Aspect Ratio)
                    </label>
                </div>
                <div style={{ flex: 1 }}></div>
                <button className="btn btn-sm btn-secondary" onClick={() => {
                    // TODO: undo実装移動による補完
                }}>↶ Undo</button>
                <button className="btn btn-sm btn-secondary" onClick={() => { }}>↷ Redo</button>
            </div>
        </div>
    );
}

const rootEl = document.getElementById("root");
if (rootEl) {
    const root = createRoot(rootEl);
    root.render(<ManageApp />);
}
