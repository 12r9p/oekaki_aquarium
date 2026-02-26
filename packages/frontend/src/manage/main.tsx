import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom/client";
import type { WsServerMessage, DisplayClientInfo, TestPattern, ActiveFish, PendingFish } from "@aquarium/shared";
import { createWsClient } from "../shared/useWs";
import "../styles/global.css";
import "./manage.css";

// コンポーネント群をimport
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { ViewportCanvas } from "./components/ViewportCanvas";

// ============================================================
// manage/main.tsx — SaaS グレード管理画面
// ============================================================

export const ws = createWsClient("manage");

function ManageApp(): React.ReactElement {
    const [tab, setTab] = useState<"layout" | "fish" | "pending">("layout");
    const [displays, setDisplays] = useState<DisplayClientInfo[]>([]);
    const [activeFish, setActiveFish] = useState<ActiveFish[]>([]);
    const [pendingFish, setPendingFish] = useState<PendingFish[]>([]);
    const [connected, setConnected] = useState(false);
    const [alert, setAlert] = useState<string | null>(null);

    // 新規追加機能: 送信レート設定
    const [sendRateSetting, setSendRateSetting] = useState(33); // プレビュー送信等のレート(ms), 30fps程度;

    const showAlert = (msg: string): void => {
        setAlert(msg);
        setTimeout(() => setAlert(null), 2500);
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
            };
            setDisplays(data.clients.filter((c) => c.clientType === "display"));
            setActiveFish(data.activeFish);
            setPendingFish(data.pendingFish);
        } catch {/* ignore */ }
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
        if (!confirm("全ての魚を削除しますか？")) return;
        await fetch("/api/fish/all", { method: "DELETE" });
        void poll();
    };

    const addDemoFish = async (): Promise<void> => {
        // デモ用の魚（絵文字）を投下
        const demos = ["🐟", "🐠", "🐡", "🐙", "🦑", "🦐", "🦈", "🐬", "🐋"];
        const emj = demos[Math.floor(Math.random() * demos.length)];

        // 絵文字をCanvasに描画してDataURL化
        const canvas = document.createElement("canvas");
        canvas.width = 128; canvas.height = 128;
        const ctx = canvas.getContext("2d");
        if (ctx) {
            ctx.font = "96px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(emj, 64, 64);
        }
        canvas.toBlob(async (blob) => {
            if (!blob) return;
            const formData = new FormData();
            formData.append("image", blob, `demo_${Date.now()}.png`);

            try {
                const res = await fetch("/api/scan", {
                    method: "POST",
                    body: formData
                });
                const data = await res.json() as { fish: { id: string } };
                // 放流APIを叩く
                await fetch("/api/release", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ pendingId: data.fish.id })
                });
                showAlert(`デモ魚 ${emj} を追加しました`);
                void poll();
            } catch (e) {
                showAlert("デモ魚追加エラー");
            }
        }, "image/png");
    };

    return (
        <div className="manage">
            {alert && <div className="manage-toast">{alert}</div>}

            <Toolbar
                displays={displays} activeFish={activeFish} pendingFish={pendingFish}
                connected={connected} tab={tab} setTab={setTab}
                sendRateSetting={sendRateSetting} setSendRateSetting={setSendRateSetting}
                onAddDemoFish={addDemoFish}
            />

            <main className="manage-body">
                {tab === "layout" && (
                    <LayoutTab
                        displays={displays}
                        onSaveViewport={saveViewport}
                        onTestPattern={sendTestPattern}
                        sendRateSetting={sendRateSetting}
                        onAddDemoFish={addDemoFish}
                    />
                )}
                {tab === "fish" && (
                    <div style={{ padding: "20px" }}>
                        <h3>水槽の魚一覧 (開発中タブ)</h3>
                        <button className="manage-btn" onClick={removeAllFish}>全消去</button>
                        <hr />
                        {activeFish.map(f => (
                            <div key={f.id}>{f.id}</div>
                        ))}
                    </div>
                )}
                {tab === "pending" && (
                    <div style={{ padding: "20px" }}>
                        <h3>待機中の魚一覧 (開発中タブ)</h3>
                        {pendingFish.map(f => (
                            <div key={f.id}>{f.id}</div>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}

// -------- ディスプレイ配置タブ --------------------------------
function LayoutTab({
    displays,
    onSaveViewport,
    onTestPattern,
    sendRateSetting,
    onAddDemoFish
}: {
    displays: DisplayClientInfo[];
    onSaveViewport: (uuid: string, vp: NonNullable<DisplayClientInfo["viewport"]>) => Promise<void>;
    onTestPattern: (pattern: TestPattern, uuid?: string) => Promise<void>;
    sendRateSetting: number;
    onAddDemoFish: () => void;
}): React.ReactElement {
    const [selected, setSelected] = useState<string | null>(null);
    const [arLocked, setArLocked] = useState(true);

    const [displaysSt, setDisplaysSt] = useState<DisplayClientInfo[]>([]);
    const displaysRef = useRef<DisplayClientInfo[]>([]);
    const pendingViewports = useRef<Map<string, NonNullable<DisplayClientInfo["viewport"]>>>(new Map());
    const hoveredRef = useRef<string | null>(null);
    const setHoveredUI = useCallback((id: string | null) => { }, []); // (省略)ホバー時のSidebar同期用など

    // Undo/Redo ref
    const undoStackRef = useRef<any[]>([]);
    const redoStackRef = useRef<any[]>([]);
    const snapshotViewports = useCallback(() => {
        return displaysRef.current.filter(d => d.viewport !== null).map(d => ({ uuid: d.uuid, viewport: { ...d.viewport! } }));
    }, []);

    // ワールドサイズ
    const worldW = 3840;
    const worldH = 1080;

    useEffect(() => {
        displaysRef.current = displays.map(d => {
            const pending = pendingViewports.current.get(d.uuid);
            return pending ? { ...d, viewport: pending } : { ...d, viewport: d.viewport ? { ...d.viewport } : null };
        });
        setDisplaysSt([...displaysRef.current]);
    }, [displays]);

    return (
        <div className="layout-tab">
            <div className="layout-main">
                <ViewportCanvas
                    worldW={worldW} worldH={worldH}
                    displaysSt={displaysSt} displaysRef={displaysRef}
                    pendingViewports={pendingViewports}
                    selected={selected} setSelected={setSelected}
                    hoveredRef={hoveredRef} setHoveredUI={setHoveredUI}
                    undoStackRef={undoStackRef} redoStackRef={redoStackRef} snapshotViewports={snapshotViewports}
                    onSaveViewport={onSaveViewport}
                    arLocked={arLocked}
                    sendRateSetting={sendRateSetting}
                />

                <Sidebar
                    displays={displaysSt}
                    selectedDisplayIds={selected ? [selected] : []}
                    onTestPattern={onTestPattern}
                    worldW={worldW} worldH={worldH}
                    onAddDemoFish={onAddDemoFish}
                    onSaveViewport={onSaveViewport}
                />
            </div>

            <div className="layout-statusbar">
                <div style={{ display: 'flex', gap: '8px', fontSize: '13px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', color: '#fff' }}>
                        <input type="checkbox" checked={arLocked} onChange={e => setArLocked(e.target.checked)} />
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
    const root = ReactDOM.createRoot(rootEl);
    root.render(<ManageApp />);
}
