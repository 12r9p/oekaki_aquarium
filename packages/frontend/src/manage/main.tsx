import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom/client";
import type { WsServerMessage, DisplayClientInfo, TestPattern, ActiveFish, PendingFish } from "@aquarium/shared";
import { createWsClient } from "../shared/useWs";
import "../styles/global.css";
import "./manage.css";

// ============================================================
// manage/main.tsx — SaaS グレード管理画面
// ============================================================

const ws = createWsClient("manage");

// -------- メインアプリ ----------------------------------------
function ManageApp(): React.ReactElement {
    const [tab, setTab] = useState<"layout" | "fish" | "pending">("layout");
    const [displays, setDisplays] = useState<DisplayClientInfo[]>([]);
    const [activeFish, setActiveFish] = useState<ActiveFish[]>([]);
    const [pendingFish, setPendingFish] = useState<PendingFish[]>([]);
    const [connected, setConnected] = useState(false);
    const [alert, setAlert] = useState<string | null>(null);

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
                // display クライアントのみ抽出
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
        const res = await fetch(`/api/clients/${uuid}/viewport`, {
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

    return (
        <div className="manage">
            {/* Toastアラート */}
            {alert && <div className="manage-toast">{alert}</div>}

            <header className="manage-header">
                <div className="manage-logo">🎛 お絵かき水族館・管理画面</div>
                <div className="manage-header-right">
                    <span className="manage-stat">🖥 {displays.length}台</span>
                    <span className="manage-stat">🐟 {activeFish.length}匹</span>
                    <span className="manage-stat">⏳ {pendingFish.length}匹</span>
                    <div className={`manage-connection ${connected ? "ok" : "ng"}`}>
                        {connected ? "🟢 WS接続中" : "🔴 切断"}
                    </div>
                </div>
            </header>

            <nav className="manage-tabs">
                {(["layout", "fish", "pending"] as const).map((t) => (
                    <button key={t} className={`manage-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
                        {{ layout: "🗺 ディスプレイ配置", fish: "🐟 水槽の魚", pending: "⏳ 待合室" }[t]}
                    </button>
                ))}
            </nav>

            <main className="manage-body">
                {tab === "layout" && (
                    <LayoutTab
                        displays={displays}
                        onSaveViewport={saveViewport}
                        onTestPattern={sendTestPattern}
                    />
                )}
                {tab === "fish" && <FishTab fish={activeFish} onRemoveAll={removeAllFish} polling={poll} />}
                {tab === "pending" && <PendingTab fish={pendingFish} />}
            </main>
        </div>
    );
}

// -------- ディスプレイ配置タブ --------------------------------
// ハンドルの種類（8点＋ボディ移動）
type HandleType = "move" | "tl" | "t" | "tr" | "r" | "br" | "b" | "bl" | "l";

// カメラ（パン・ズーム）状態
interface Camera { panX: number; panY: number; zoom: number; }

// ドラッグ状態（全てRefで持ち、ReactのstateをmousemoveでSetしない）
interface DragState {
    handle: HandleType;
    uuid: string;
    startMouseX: number; startMouseY: number;
    startVp: { x: number; y: number; width: number; height: number; scale: number };
}

const HANDLE_R = 6; // リサイズハンドルの半径(px, canvas座標)
const COLORS = ["#4ecdc4", "#ff6b6b", "#f7dc6f", "#82e0aa", "#bb8fce", "#f0b27a"];

/**ディスプレイのビューポートから8ハンドル座標を返す（ワールド座標）*/
function getHandles(vp: NonNullable<DisplayClientInfo["viewport"]>): Record<HandleType, { x: number; y: number }> {
    const { x, y, width: w, height: h } = vp;
    return {
        move: { x: x + w / 2, y: y + h / 2 },
        tl: { x, y }, t: { x: x + w / 2, y }, tr: { x: x + w, y },
        r: { x: x + w, y: y + h / 2 }, br: { x: x + w, y: y + h },
        b: { x: x + w / 2, y: y + h }, bl: { x, y: y + h },
        l: { x, y: y + h / 2 },
    };
}

function LayoutTab({
    displays,
    onSaveViewport,
    onTestPattern,
}: {
    displays: DisplayClientInfo[];
    onSaveViewport: (uuid: string, vp: DisplayClientInfo["viewport"]) => Promise<void>;
    onTestPattern: (pattern: TestPattern, uuid?: string) => Promise<void>;
}): React.ReactElement {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [selected, setSelected] = useState<string | null>(null);
    // Reactのrenderに使うstate（ドラッグ完了後のみ更新）
    const [displaysSt, setDisplaysSt] = useState<DisplayClientInfo[]>([]);
    // ドラッグ中はrefで高速管理
    const displaysRef = useRef<DisplayClientInfo[]>([]);
    const dragRef = useRef<DragState | null>(null);
    const camRef = useRef<Camera>({ panX: 0, panY: 0, zoom: 1 });
    const rafRef = useRef<number | null>(null);
    const isPanningRef = useRef(false);
    const panStartRef = useRef({ mx: 0, my: 0, px: 0, py: 0 });
    const spaceRef = useRef(false);
    // ワールドサイズ設定
    const [worldW, setWorldW] = useState(3840);
    const [worldH, setWorldH] = useState(1080);

    // 外部 displays → ref & state に同期（ドラッグ中は無視）
    useEffect(() => {
        if (!dragRef.current) {
            displaysRef.current = displays.map(d => ({ ...d, viewport: d.viewport ? { ...d.viewport } : null }));
            setDisplaysSt([...displaysRef.current]);
        }
    }, [displays]);

    // ---- カメラ変換ヘルパー ----
    const canvasSize = useCallback(() => {
        const c = canvasRef.current;
        return c ? { w: c.width, h: c.height } : { w: 760, h: 214 };
    }, []);

    const worldToCanvas = useCallback((wx: number, wy: number): { x: number; y: number } => {
        const cam = camRef.current;
        return { x: wx * cam.zoom + cam.panX, y: wy * cam.zoom + cam.panY };
    }, []);

    const canvasToWorld = useCallback((cx: number, cy: number): { x: number; y: number } => {
        const cam = camRef.current;
        return { x: (cx - cam.panX) / cam.zoom, y: (cy - cam.panY) / cam.zoom };
    }, []);

    // ---- Canvas 描画（pure canvas API, Reactのrenderとは独立） ----
    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const { w: CW, h: CH } = canvasSize();
        ctx.clearRect(0, 0, CW, CH);

        // 背景
        ctx.fillStyle = "#080c14";
        ctx.fillRect(0, 0, CW, CH);

        // ワールド矩形
        const tl = worldToCanvas(0, 0);
        const br = worldToCanvas(worldW, worldH);
        ctx.fillStyle = "#0d1320";
        ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        ctx.strokeStyle = "rgba(100,150,255,0.3)";
        ctx.lineWidth = 1;
        ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

        const cam = camRef.current;

        // グリッド（100px間隔）
        const gridStep = 100;
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.lineWidth = 0.5;
        const startX = Math.floor(-cam.panX / cam.zoom / gridStep) * gridStep;
        const startY = Math.floor(-cam.panY / cam.zoom / gridStep) * gridStep;
        for (let x = startX; x <= startX + CW / cam.zoom + gridStep * 2; x += gridStep) {
            const cx = worldToCanvas(x, 0).x;
            ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, CH); ctx.stroke();
        }
        for (let y = startY; y <= startY + CH / cam.zoom + gridStep * 2; y += gridStep) {
            const cy = worldToCanvas(0, y).y;
            ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(CW, cy); ctx.stroke();
        }

        // 500px 目盛りラベル
        ctx.fillStyle = "rgba(255,255,255,0.2)";
        ctx.font = `${Math.max(8, 9 * cam.zoom)}px monospace`;
        for (let x = 0; x <= worldW; x += 500) {
            const cx = worldToCanvas(x, 0).x;
            ctx.fillText(String(x), cx + 2, tl.y + 12);
        }
        for (let y = 0; y <= worldH; y += 200) {
            const cy = worldToCanvas(0, y).y;
            ctx.fillText(String(y), tl.x + 2, cy - 2);
        }

        // 各ディスプレイ
        displaysRef.current.forEach((d, i) => {
            const vp = d.viewport;
            if (!vp) return;
            const p = worldToCanvas(vp.x, vp.y);
            const p2 = worldToCanvas(vp.x + vp.width, vp.y + vp.height);
            const dw = p2.x - p.x;
            const dh = p2.y - p.y;
            const col = COLORS[i % COLORS.length];
            const isSel = d.uuid === selected;

            // 影
            if (isSel) { ctx.shadowColor = col; ctx.shadowBlur = 12; }
            ctx.fillStyle = isSel
                ? col + "55"
                : col + "22";
            ctx.fillRect(p.x, p.y, dw, dh);
            ctx.shadowBlur = 0;

            ctx.strokeStyle = col;
            ctx.lineWidth = isSel ? 2.5 : 1.5;
            ctx.strokeRect(p.x + 0.5, p.y + 0.5, dw - 1, dh - 1);

            // ラベル（ズームに応じてフォントサイズ調整）
            const fs = Math.max(9, Math.min(13, 10 * cam.zoom));
            ctx.fillStyle = col;
            ctx.font = `bold ${fs}px monospace`;
            if (dw > 60) ctx.fillText(d.uuid.slice(0, 8), p.x + 5, p.y + fs + 4);
            ctx.font = `${Math.max(8, fs - 1)}px monospace`;
            if (dh > 30 && dw > 100) ctx.fillText(`${vp.x},${vp.y}  ${vp.width}×${vp.height}`, p.x + 5, p.y + fs * 2 + 5);

            if (d.testPattern !== "off") {
                ctx.fillStyle = "rgba(255,220,0,0.9)";
                ctx.font = `${fs - 1}px sans-serif`;
                ctx.fillText(`🧪 ${d.testPattern}`, p.x + 5, p2.y - 5);
            }

            // リサイズハンドル（選択中のみ）
            if (isSel) {
                const handles = getHandles(vp);
                (Object.entries(handles) as [HandleType, { x: number; y: number }][]).forEach(([, wpos]) => {
                    const hp = worldToCanvas(wpos.x, wpos.y);
                    ctx.beginPath();
                    ctx.arc(hp.x, hp.y, HANDLE_R, 0, Math.PI * 2);
                    ctx.fillStyle = "#fff";
                    ctx.fill();
                    ctx.strokeStyle = col;
                    ctx.lineWidth = 2;
                    ctx.stroke();
                });
            }
        });

        // ズーム率表示
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.font = "10px monospace";
        ctx.fillText(`zoom: ${(cam.zoom * 100).toFixed(0)}%  world: ${worldW}×${worldH}`, 6, CH - 6);
    }, [worldToCanvas, canvasToWorld, canvasSize, selected, worldW, worldH]);

    // stateが変わったらdrawをスケジュール
    useEffect(() => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(draw);
    }, [draw, displaysSt]);

    // ---- ファイット（Fキー or ボタン） ----
    const fitView = useCallback(() => {
        const { w: CW, h: CH } = canvasSize();
        const zx = CW / worldW;
        const zy = CH / worldH;
        const z = Math.min(zx, zy) * 0.9;
        camRef.current = { panX: (CW - worldW * z) / 2, panY: (CH - worldH * z) / 2, zoom: z };
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(draw);
    }, [canvasSize, draw, worldW, worldH]);

    // 初期フィット
    useEffect(() => { fitView(); }, [fitView]);

    // キーイベント（Space = pan mode）
    useEffect(() => {
        const kd = (e: KeyboardEvent) => {
            if (e.code === "Space") { spaceRef.current = true; e.preventDefault(); }
            if (e.code === "KeyF") fitView();
        };
        const ku = (e: KeyboardEvent) => { if (e.code === "Space") spaceRef.current = false; };
        window.addEventListener("keydown", kd);
        window.addEventListener("keyup", ku);
        return () => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); };
    }, [fitView]);

    // ホイールズーム
    const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        const rect = canvasRef.current!.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        const cam = camRef.current;
        const newZoom = Math.max(0.05, Math.min(10, cam.zoom * factor));
        // ズームの中心をマウス位置に
        camRef.current = {
            zoom: newZoom,
            panX: mx - (mx - cam.panX) * (newZoom / cam.zoom),
            panY: my - (my - cam.panY) * (newZoom / cam.zoom),
        };
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(draw);
    }, [draw]);

    // ---- ヒットテスト ----
    /** ハンドルにヒットしているか判定（canvas座標） */
    const hitHandle = useCallback((mx: number, my: number, vp: NonNullable<DisplayClientInfo["viewport"]>): HandleType | null => {
        const handles = getHandles(vp);
        for (const [name, wpos] of Object.entries(handles) as [HandleType, { x: number; y: number }][]) {
            if (name === "move") continue;
            const cp = worldToCanvas(wpos.x, wpos.y);
            const dx = mx - cp.x, dy = my - cp.y;
            if (dx * dx + dy * dy <= (HANDLE_R + 3) * (HANDLE_R + 3)) return name;
        }
        return null;
    }, [worldToCanvas]);

    // ---- マウスイベント ----
    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = canvasRef.current!.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        // Space or middle mouse → pan
        if (spaceRef.current || e.button === 1) {
            isPanningRef.current = true;
            panStartRef.current = { mx, my, px: camRef.current.panX, py: camRef.current.panY };
            return;
        }

        const wp = canvasToWorld(mx, my);

        // 選択中なら先にハンドル判定
        if (selected) {
            const d = displaysRef.current.find(d => d.uuid === selected);
            if (d?.viewport) {
                const h = hitHandle(mx, my, d.viewport);
                if (h) {
                    dragRef.current = { handle: h, uuid: d.uuid, startMouseX: mx, startMouseY: my, startVp: { ...d.viewport } };
                    return;
                }
            }
        }

        // ボディヒット判定（上から順）
        for (const d of [...displaysRef.current].reverse()) {
            const vp = d.viewport;
            if (!vp) continue;
            if (wp.x >= vp.x && wp.x <= vp.x + vp.width && wp.y >= vp.y && wp.y <= vp.y + vp.height) {
                setSelected(d.uuid);
                dragRef.current = { handle: "move", uuid: d.uuid, startMouseX: mx, startMouseY: my, startVp: { ...vp } };
                return;
            }
        }
        setSelected(null);
    }, [selected, hitHandle, canvasToWorld]);

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = canvasRef.current!.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        // パン
        if (isPanningRef.current) {
            camRef.current.panX = panStartRef.current.px + (mx - panStartRef.current.mx);
            camRef.current.panY = panStartRef.current.py + (my - panStartRef.current.my);
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(draw);
            return;
        }

        if (!dragRef.current) return;
        const { handle, uuid, startMouseX, startMouseY, startVp } = dragRef.current;
        // ドラッグ差分をワールド座標へ変換
        const dwx = (mx - startMouseX) / camRef.current.zoom;
        const dwy = (my - startMouseY) / camRef.current.zoom;
        const snap = e.shiftKey ? 10 : 1; // Shiftでスナップ

        const clamp = (v: number, mn = 0) => Math.round(Math.max(mn, v) / snap) * snap;
        const minSize = 100;

        const newVp = { ...startVp };
        switch (handle) {
            case "move": newVp.x = clamp(startVp.x + dwx); newVp.y = clamp(startVp.y + dwy); break;
            case "r": newVp.width = clamp(startVp.width + dwx, minSize); break;
            case "b": newVp.height = clamp(startVp.height + dwy, minSize); break;
            case "l": { const nw = clamp(startVp.width - dwx, minSize); newVp.x = startVp.x + startVp.width - nw; newVp.width = nw; } break;
            case "t": { const nh = clamp(startVp.height - dwy, minSize); newVp.y = startVp.y + startVp.height - nh; newVp.height = nh; } break;
            case "br": newVp.width = clamp(startVp.width + dwx, minSize); newVp.height = clamp(startVp.height + dwy, minSize); break;
            case "bl": { const nw = clamp(startVp.width - dwx, minSize); newVp.x = startVp.x + startVp.width - nw; newVp.width = nw; newVp.height = clamp(startVp.height + dwy, minSize); } break;
            case "tr": newVp.width = clamp(startVp.width + dwx, minSize); { const nh = clamp(startVp.height - dwy, minSize); newVp.y = startVp.y + startVp.height - nh; newVp.height = nh; } break;
            case "tl": { const nw = clamp(startVp.width - dwx, minSize); newVp.x = startVp.x + startVp.width - nw; newVp.width = nw; const nh = clamp(startVp.height - dwy, minSize); newVp.y = startVp.y + startVp.height - nh; newVp.height = nh; } break;
        }

        // ---- アスペクト比固定 & スケール自動計算 ----
        // displayの物理解像度(screenW/H)からARを算出して一方の辺を追従させる
        if (handle !== "move") {
            const dInfo = displaysRef.current.find(d => d.uuid === uuid);
            if (dInfo?.screenW && dInfo?.screenH) {
                const ar = dInfo.screenW / dInfo.screenH;
                if (handle === "t" || handle === "b") {
                    // 高さ優先: 幅を自動追従
                    newVp.width = Math.max(minSize, Math.round(newVp.height * ar));
                } else {
                    // 幅優先: 高さを自動追従
                    newVp.height = Math.max(minSize, Math.round(newVp.width / ar));
                }
                // 上辺が動くハンドル(tl/tr/t)はy座標を再計算（高さ変更に追従）
                if (handle === "tl" || handle === "tr" || handle === "t") {
                    newVp.y = startVp.y + startVp.height - newVp.height;
                }
                // 幅優先で左辺が動くハンドル(l/bl/tl)はxを再計算
                if (handle === "l" || handle === "bl" || handle === "tl") {
                    newVp.x = startVp.x + startVp.width - newVp.width;
                }
                // scale = 物理ピクセル幅 / ワールド幅（高解像度ディスプレイでは0より大きい値になる）
                newVp.scale = parseFloat((dInfo.screenW / newVp.width).toFixed(3));
            }
        }

        displaysRef.current = displaysRef.current.map(d => d.uuid !== uuid ? d : { ...d, viewport: newVp });
        // RAFでcanvasを再描画（60fps）
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(draw);
    }, [draw]);

    const handleMouseUp = useCallback(() => {
        isPanningRef.current = false;
        if (!dragRef.current) return;
        const { uuid } = dragRef.current;
        dragRef.current = null;
        // Reactステートに同期してサイドパネルを更新
        setDisplaysSt([...displaysRef.current]);
        // ドラッグ終了後、即座にAPIでサーバーに保存する。
        // これをしないと、サーバーの5秒ごとの client_list プッシュで旧Viewportに上書きされる。
        const moved = displaysRef.current.find(d => d.uuid === uuid);
        if (moved?.viewport) {
            void fetch(`/api/clients/${encodeURIComponent(uuid)}/viewport`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(moved.viewport),
            });
        }
    }, []);


    const selDisplay = displaysSt.find(d => d.uuid === selected);

    return (
        <div className="tab-content layout-tab">
            {/* ワールドサイズ設定ツールバー */}
            <div className="world-toolbar">
                <span className="toolbar-label">🌐 ワールドサイズ:</span>
                <label className="world-field">
                    <span>W</span>
                    <input type="number" value={worldW} step={100}
                        onChange={(e) => setWorldW(parseInt(e.target.value) || 3840)} />
                </label>
                <label className="world-field">
                    <span>H</span>
                    <input type="number" value={worldH} step={100}
                        onChange={(e) => setWorldH(parseInt(e.target.value) || 1080)} />
                </label>
                <span className="toolbar-sep">|</span>
                {([
                    [3840, 1080, "4K横2面"], [3840, 2160, "4K縦2面"], [1920, 1080, "FHD"], [5760, 1080, "横3面"],
                ] as [number, number, string][]).map(([w, h, label]) => (
                    <button key={label} className="btn btn-sm btn-secondary"
                        onClick={() => { setWorldW(w); setWorldH(h); }}>
                        {label}
                    </button>
                ))}
                <span className="toolbar-sep">|</span>
                <button className="btn btn-sm btn-secondary" onClick={fitView} title="Fキーでフィット">🔍 Fit (F)</button>
            </div>

            <div className="layout-top">
                {/* Canvas エディタ */}
                <div className="layout-canvas-wrapper" ref={wrapperRef}>
                    <div className="layout-canvas-label">
                        Space+ドラッグ: パン　ホイール: ズーム　Shiftドラッグ: 10pxスナップ　F: 全体表示
                    </div>
                    <canvas
                        ref={canvasRef} width={780} height={280}
                        className="layout-canvas"
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                        onWheel={handleWheel}
                        style={{ cursor: spaceRef.current ? "grab" : "default" }}
                    />
                    {/* テストパターン全体一括送信 */}
                    <div className="pattern-toolbar">
                        <span className="toolbar-label">🧪 全ディスプレイにテストパターン送信:</span>
                        {(["off", "grid", "colorbars", "crosshair", "white", "black", "worldmap"] as TestPattern[]).map((p) => (
                            <button key={p} className="btn btn-sm btn-pattern"
                                onClick={() => void onTestPattern(p)}>
                                {p === "off" ? "⬛ オフ" : p === "worldmap" ? "🗺 ワールドマップ" : p}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 選択ディスプレイのプロパティパネル */}
                <div className="layout-sidebar">
                    {selDisplay ? (
                        <DisplayPanel
                            key={selDisplay.uuid}
                            display={selDisplay}
                            onSave={async (vp) => {
                                // Apply時: displaysRefを即時更新してcanvasを再描画（サーバーのpushを待たない）
                                displaysRef.current = displaysRef.current.map(d =>
                                    d.uuid !== selDisplay.uuid ? d : { ...d, viewport: vp }
                                );
                                setDisplaysSt([...displaysRef.current]);
                                if (rafRef.current) cancelAnimationFrame(rafRef.current);
                                rafRef.current = requestAnimationFrame(draw);
                                await onSaveViewport(selDisplay.uuid, vp);
                            }}
                            onPreviewViewport={(vp) => {
                                // 数値入力中: displaysRefをリアルタイム更新してcanvasを再描画
                                displaysRef.current = displaysRef.current.map(d =>
                                    d.uuid !== selDisplay.uuid ? d : { ...d, viewport: vp }
                                );
                                if (rafRef.current) cancelAnimationFrame(rafRef.current);
                                rafRef.current = requestAnimationFrame(draw);
                            }}
                            onTestPattern={(p) => { void onTestPattern(p, selDisplay.uuid); }}
                        />
                    ) : (
                        <div className="sidebar-empty">
                            <div style={{ fontSize: 40 }}>🖥</div>
                            <p>ディスプレイを選択してください</p>
                            <p style={{ fontSize: "0.8rem", color: "#4a5568", marginTop: 8 }}>
                                Canvasをクリックするか<br />新しいタブで<code>/display</code>を開いてください
                            </p>
                            <a className="btn btn-primary" style={{ marginTop: 16, display: "inline-block" }}
                                href="/display?vx=0&vy=0&vw=1920&vh=1080" target="_blank">
                                + ディスプレイを開く
                            </a>
                        </div>
                    )}

                    {/* 接続ディスプレイ一覧 */}
                    <div className="sidebar-section">
                        <h3 className="sidebar-section-title">接続中 ({displaysSt.length}台)</h3>
                        {displaysSt.length === 0 ? (
                            <p className="empty-msg">接続中のディスプレイなし</p>
                        ) : (
                            displaysSt.map((d: DisplayClientInfo, i: number) => {
                                const color = COLORS[i % COLORS.length];
                                return (
                                    <div
                                        key={d.uuid}
                                        className={`client-item ${selected === d.uuid ? "active" : ""}`}
                                        style={{ borderLeftColor: color }}
                                        onClick={() => setSelected(d.uuid)}
                                    >
                                        <div className="client-item-id">{d.uuid.slice(0, 8)}</div>
                                        <div className="client-item-meta">
                                            {d.viewport
                                                ? `${d.viewport.x},${d.viewport.y} / ${d.viewport.width}×${d.viewport.height}`
                                                : "Viewport未設定"}
                                        </div>
                                        <div className="client-item-meta">
                                            {Math.round((Date.now() - d.lastSeen) / 1000)}秒前
                                            {d.testPattern !== "off" && <span className="badge-pattern"> 🧪{d.testPattern}</span>}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// -------- 選択ディスプレイパネル ----------------------------
function DisplayPanel({
    display,
    onSave,
    onPreviewViewport,
    onTestPattern,
}: {
    display: DisplayClientInfo;
    onSave: (vp: DisplayClientInfo["viewport"]) => Promise<void>;
    /** 数値入力中にリアルタイムでcanvasへ伝える */
    onPreviewViewport: (vp: NonNullable<DisplayClientInfo["viewport"]>) => void;
    onTestPattern: (p: TestPattern) => void;
}): React.ReactElement {
    const [form, setForm] = useState(display.viewport ?? { x: 0, y: 0, width: 1920, height: 1080, scale: 1 });

    // ドラッグ、または外部更新でdisplay.viewportが変わったらformを同期する
    // （ただし フォーカス中の入力欄は上書きしないようuseEffectで制御）
    const prevVpRef = useRef(display.viewport);
    useEffect(() => {
        const prev = prevVpRef.current;
        const cur = display.viewport;
        // 値が変わった時だけ同期（連続タイピング中は外部からは変わらないので問題なし）
        if (!cur) return;
        if (!prev || prev.x !== cur.x || prev.y !== cur.y ||
            prev.width !== cur.width || prev.height !== cur.height || prev.scale !== cur.scale) {
            setForm({ ...cur });
            prevVpRef.current = cur;
        }
    }, [display.viewport]);

    const set = (k: keyof typeof form, v: number) => {
        const next = { ...form, [k]: v };
        setForm(next);
        // 入力のたびにcanvasをリアルタイム更新（プレビュー）
        onPreviewViewport(next);
    };

    const displayUrl = `/display?vx=${form.x}&vy=${form.y}&vw=${form.width}&vh=${form.height}&scale=${form.scale}`;

    return (
        <div className="display-panel">
            <div className="panel-title">
                🖥 <code>{display.uuid.slice(0, 12)}</code>
            </div>

            {/* Viewport 編集 */}
            <div className="panel-section">
                <div className="panel-section-title">📐 Viewport 設定</div>
                <div className="vp-grid">
                    {(["x", "y", "width", "height", "scale"] as const).map((k) => (
                        <label key={k} className="vp-field">
                            <span>{k}</span>
                            <input type="number" value={form[k]} step={k === "scale" ? 0.1 : 1}
                                onChange={(e) => set(k, parseFloat(e.target.value))} />
                        </label>
                    ))}
                </div>
                <div className="panel-actions">
                    <button className="btn btn-primary" onClick={() => void onSave(form)}>✅ 適用</button>
                    <a className="btn btn-secondary" href={displayUrl} target="_blank">↗ このURLで開く</a>
                </div>
                <div className="url-preview"><code>{displayUrl}</code></div>
            </div>

            {/* テストパターン */}
            <div className="panel-section">
                <div className="panel-section-title">🧪 テストパターン</div>
                <div className="pattern-grid">
                    {(["off", "grid", "colorbars", "crosshair", "white", "black", "worldmap"] as TestPattern[]).map((p) => (
                        <button
                            key={p}
                            className={`btn btn-pattern ${display.testPattern === p ? "active" : ""}`}
                            onClick={() => void onTestPattern(p)}
                        >
                            {{ off: "⬛ オフ", grid: "# グリッド", colorbars: "🎨 カラーバー", crosshair: "⊕ 十字", white: "◻ 白", black: "◼ 黒", worldmap: "🗺 ワールドマップ" }[p]}
                        </button>
                    ))}
                </div>
                <p className="hint-small">テストパターンをオンにするとフレーム描画が一時停止されます</p>
            </div>
        </div>
    );
}

// -------- 水槽内の魚 -----------------------------------------
function FishTab({ fish, onRemoveAll, polling }: { fish: ActiveFish[]; onRemoveAll: () => Promise<void>; polling: () => Promise<void> }): React.ReactElement {
    const pinFish = async (id: string, val: boolean) => {
        await fetch(`/api/fish/${id}/pin`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned: val }),
        });
        void polling();
    };
    const rm = async (id: string) => { await fetch(`/api/fish/${id}`, { method: "DELETE" }); void polling(); };

    return (
        <div className="tab-content">
            <div className="section-header">
                <h2>水槽内の魚 ({fish.length}匹)</h2>
                <button className="btn btn-sm btn-danger" onClick={() => void onRemoveAll()}>🗑 全削除</button>
            </div>
            <table className="manage-table">
                <thead><tr><th>ID</th><th>タイプ</th><th>座標</th><th>レイヤー</th><th>操作</th></tr></thead>
                <tbody>
                    {fish.map((f) => (
                        <tr key={f.id}>
                            <td><code>{f.id.slice(0, 8)}</code></td>
                            <td><span className={`badge badge-${f.type}`}>{f.type}</span></td>
                            <td>({Math.round(f.physics.pos.x)}, {Math.round(f.physics.pos.y)})</td>
                            <td>{f.layerIndex}</td>
                            <td className="action-cell">
                                <button className="btn btn-sm btn-secondary" onClick={() => void pinFish(f.id, !f.isPinned)}>
                                    {f.isPinned ? "📌 解除" : "📌 固定"}
                                </button>
                                <button className="btn btn-sm btn-danger" onClick={() => void rm(f.id)}>🗑</button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// -------- 待合室 ---------------------------------------------
function PendingTab({ fish }: { fish: PendingFish[] }): React.ReactElement {
    return (
        <div className="tab-content">
            <div className="section-header">
                <h2>待合室 ({fish.length}匹)</h2>
                <a href="/controller" target="_blank" className="btn btn-sm btn-secondary">コントローラーを開く</a>
            </div>
            <div className="pending-grid">
                {fish.map((f) => (
                    <div key={f.id} className={`pending-card ${f.lockedBy ? "locked" : ""}`}>
                        <img src={f.imageUrl} alt="" />
                        <p>{f.id.slice(0, 8)}</p>
                        {f.lockedBy && <span className="locked-badge">編集中</span>}
                    </div>
                ))}
            </div>
        </div>
    );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode><ManageApp /></React.StrictMode>
);
