import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom/client";
import type { WsServerMessage, DisplayClientInfo, TestPattern, ActiveFish, PendingFish, WorldObject, WsClientMessage } from "@aquarium/shared";
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
        // uuid が "display:id" 形式の場合、:はURLパスで問題になるためエンコードする
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
    const [hovered, setHovered] = useState<string | null>(null);
    const [arLocked, setArLocked] = useState(true); // ARロックトグル

    // React render用state（ドラッグ完了・選択変更のみ更新）
    const [displaysSt, setDisplaysSt] = useState<DisplayClientInfo[]>([]);

    // ドラッグ中の高速管理はすべてref
    const displaysRef = useRef<DisplayClientInfo[]>([]);

    /**
     * pendingViewports: ローカルで変更したがサーバー未確認のViewportを保持。
     * server の client_list push でドラッグ後の位置が上書きされないよう、
     * 同期時にこのMapの値を優先して上書きマージする。
     * fetch PUT が完了したら uuid をMapから削除する。
     */
    const pendingViewports = useRef<Map<string, NonNullable<DisplayClientInfo["viewport"]>>>(new Map());

    const dragRef = useRef<DragState | null>(null);
    const camRef = useRef<Camera>({ panX: 0, panY: 0, zoom: 1 });
    const rafRef = useRef<number | null>(null);
    const isPanningRef = useRef(false);
    const panStartRef = useRef({ mx: 0, my: 0, px: 0, py: 0 });
    const spaceRef = useRef(false);
    const hoveredRef = useRef<string | null>(null);
    // draw関数への遅延参照（undo/redoが宣言前のdrawを呼び出すため）
    const drawRef = useRef<() => void>(() => void 0);

    // Undo/Redo スタック（viewport変更前のスナップショットを积む）
    type ViewportSnapshot = { uuid: string; viewport: NonNullable<DisplayClientInfo["viewport"]> }[];
    const undoStackRef = useRef<ViewportSnapshot[]>([]);
    const redoStackRef = useRef<ViewportSnapshot[]>([]);

    // VP_previewリアルタイム送信のレート制限（100ms間隔）
    const previewThrottleRef = useRef<number>(0);
    // pointer_move送信のレート制限（50ms間隔 = 20fps）
    const pointerThrottleRef = useRef<number>(0);

    /** 現在のViewportスナップショットを作成 */
    const snapshotViewports = useCallback((): ViewportSnapshot => {
        return displaysRef.current
            .filter(d => d.viewport !== null)
            .map(d => ({ uuid: d.uuid, viewport: { ...d.viewport! } }));
    }, []);

    /** Undo実行 */
    const undo = useCallback((): void => {
        const snap = undoStackRef.current.pop();
        if (!snap) return;
        // 現在状態をredoに保存
        redoStackRef.current.push(snapshotViewports());
        // viewportを復元
        displaysRef.current = displaysRef.current.map(d => {
            const s = snap.find(s => s.uuid === d.uuid);
            return s ? { ...d, viewport: s.viewport } : d;
        });
        setDisplaysSt([...displaysRef.current]);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(drawRef.current);
    }, [snapshotViewports]);

    /** Redo実行 */
    const redo = useCallback((): void => {
        const snap = redoStackRef.current.pop();
        if (!snap) return;
        undoStackRef.current.push(snapshotViewports());
        displaysRef.current = displaysRef.current.map(d => {
            const s = snap.find(s => s.uuid === d.uuid);
            return s ? { ...d, viewport: s.viewport } : d;
        });
        setDisplaysSt([...displaysRef.current]);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(drawRef.current);
    }, [snapshotViewports]);

    // スナップガイド（canvas描画に使う = ドラッグ中に他ディスプレイの辺との差 < 8px でスナップ）
    const snapGuides = useRef<{ x?: number; y?: number }>({});

    // ワールドサイズ
    const [worldW, setWorldW] = useState(3840);
    const [worldH, setWorldH] = useState(1080);

    // --- サーバーからの displays と pendingViewports をマージして displaysRef に同期 ---
    useEffect(() => {
        if (!dragRef.current) {
            // pendingに登録されているものはローカル値を優先
            displaysRef.current = displays.map(d => {
                const pending = pendingViewports.current.get(d.uuid);
                return pending ? { ...d, viewport: pending } : { ...d, viewport: d.viewport ? { ...d.viewport } : null };
            });
            setDisplaysSt([...displaysRef.current]);
        }
    }, [displays]);

    // ---- カメラ変換ヘルパー ----
    const canvasSize = useCallback(() => {
        const c = canvasRef.current;
        return c ? { w: c.width, h: c.height } : { w: 780, h: 280 };
    }, []);
    const worldToCanvas = useCallback((wx: number, wy: number) => {
        const { panX, panY, zoom } = camRef.current;
        return { x: wx * zoom + panX, y: wy * zoom + panY };
    }, []);
    const canvasToWorld = useCallback((cx: number, cy: number) => {
        const { panX, panY, zoom } = camRef.current;
        return { x: (cx - panX) / zoom, y: (cy - panY) / zoom };
    }, []);

    // ---- SaaS品質 Canvas 描画 ----
    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const { w: CW, h: CH } = canvasSize();
        const cam = camRef.current;

        ctx.clearRect(0, 0, CW, CH);

        // 背景チェッカーボード（無限キャンバス感）
        ctx.fillStyle = "#080c14";
        ctx.fillRect(0, 0, CW, CH);
        const CHECKER = 24;
        ctx.fillStyle = "rgba(255,255,255,0.015)";
        for (let cx2 = 0; cx2 < CW; cx2 += CHECKER * 2) {
            for (let cy2 = 0; cy2 < CH; cy2 += CHECKER * 2) {
                ctx.fillRect(cx2, cy2, CHECKER, CHECKER);
                ctx.fillRect(cx2 + CHECKER, cy2 + CHECKER, CHECKER, CHECKER);
            }
        }

        // ワールド矩形（ドロップシャドウ付き）
        const tl = worldToCanvas(0, 0);
        const br = worldToCanvas(worldW, worldH);
        const ww = br.x - tl.x, wh = br.y - tl.y;
        ctx.shadowColor = "rgba(100,150,255,0.15)";
        ctx.shadowBlur = 20;
        ctx.fillStyle = "#0b1020";
        ctx.fillRect(tl.x, tl.y, ww, wh);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(80,120,220,0.4)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(tl.x + 0.5, tl.y + 0.5, ww - 1, wh - 1);

        // --- グリッド（100px / 500px メジャー） ---
        const GRID = 100, MAJ = 500;
        const wx0 = Math.floor(-cam.panX / cam.zoom / GRID) * GRID;
        const wy0 = Math.floor(-cam.panY / cam.zoom / GRID) * GRID;

        ctx.lineWidth = 0.5;
        ctx.strokeStyle = "rgba(255,255,255,0.04)";
        for (let x = wx0; x < wx0 + CW / cam.zoom + GRID * 2; x += GRID) {
            if (x < 0 || x > worldW) continue;
            const px = worldToCanvas(x, 0).x;
            ctx.beginPath(); ctx.moveTo(px, tl.y); ctx.lineTo(px, br.y); ctx.stroke();
        }
        for (let y = wy0; y < wy0 + CH / cam.zoom + GRID * 2; y += GRID) {
            if (y < 0 || y > worldH) continue;
            const py = worldToCanvas(0, y).y;
            ctx.beginPath(); ctx.moveTo(tl.x, py); ctx.lineTo(br.x, py); ctx.stroke();
        }
        // メジャーグリッド
        ctx.lineWidth = 0.5;
        ctx.strokeStyle = "rgba(80,120,200,0.12)";
        for (let x = 0; x <= worldW; x += MAJ) {
            const px = worldToCanvas(x, 0).x;
            ctx.beginPath(); ctx.moveTo(px, tl.y); ctx.lineTo(px, br.y); ctx.stroke();
        }
        for (let y = 0; y <= worldH; y += MAJ) {
            const py = worldToCanvas(0, y).y;
            ctx.beginPath(); ctx.moveTo(tl.x, py); ctx.lineTo(br.x, py); ctx.stroke();
        }

        // --- ルーラー（上辺、左辺） ---
        const RULER = 20;
        ctx.fillStyle = "rgba(10,16,30,0.85)";
        ctx.fillRect(0, 0, CW, RULER);
        ctx.fillRect(0, 0, RULER, CH);
        ctx.strokeStyle = "rgba(100,150,255,0.25)";
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(0, RULER); ctx.lineTo(CW, RULER); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(RULER, 0); ctx.lineTo(RULER, CH); ctx.stroke();

        ctx.fillStyle = "rgba(200,220,255,0.5)";
        ctx.font = `${Math.max(8, 7 * cam.zoom)}px monospace`;
        ctx.textBaseline = "top";
        for (let x = 0; x <= worldW; x += MAJ) {
            const px = worldToCanvas(x, 0).x;
            if (px < RULER || px > CW) continue;
            ctx.fillText(String(x), px + 2, 3);
            ctx.strokeStyle = "rgba(100,150,255,0.3)";
            ctx.lineWidth = 0.5;
            ctx.beginPath(); ctx.moveTo(px, RULER - 4); ctx.lineTo(px, RULER); ctx.stroke();
        }
        for (let y = 0; y <= worldH; y += MAJ) {
            const py = worldToCanvas(0, y).y;
            if (py < RULER || py > CH) continue;
            ctx.save();
            ctx.translate(3, py + 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(String(y), 0, 0);
            ctx.restore();
            ctx.strokeStyle = "rgba(100,150,255,0.3)";
            ctx.lineWidth = 0.5;
            ctx.beginPath(); ctx.moveTo(RULER - 4, py); ctx.lineTo(RULER, py); ctx.stroke();
        }

        // --- ディスプレイ描画 ---
        displaysRef.current.forEach((d, i) => {
            const vp = d.viewport;
            if (!vp) return;
            const p = worldToCanvas(vp.x, vp.y);
            const p2 = worldToCanvas(vp.x + vp.width, vp.y + vp.height);
            const dw = p2.x - p.x, dh = p2.y - p.y;
            const col = COLORS[i % COLORS.length];
            const isSel = d.uuid === selected;
            const isHov = d.uuid === hoveredRef.current && !isSel;

            // ドロップシャドウ
            if (isSel) {
                ctx.shadowColor = col;
                ctx.shadowBlur = 18;
            } else if (isHov) {
                ctx.shadowColor = col;
                ctx.shadowBlur = 8;
            }

            // 塗り
            ctx.fillStyle = isSel ? col + "40" : isHov ? col + "28" : col + "14";
            ctx.fillRect(p.x, p.y, dw, dh);
            ctx.shadowBlur = 0;

            // 枠線
            ctx.strokeStyle = isSel ? col : isHov ? col + "cc" : col + "66";
            ctx.lineWidth = isSel ? 2 : isHov ? 1.5 : 1;
            ctx.strokeRect(p.x + 0.5, p.y + 0.5, dw - 1, dh - 1);

            // スクリーン内のグリッドの縞模様（選択時）
            if (isSel && dw > 40 && dh > 20) {
                ctx.strokeStyle = col + "20";
                ctx.lineWidth = 0.5;
                const step = Math.max(20, 50 * cam.zoom);
                for (let sx = 0; sx < dw; sx += step) {
                    ctx.beginPath(); ctx.moveTo(p.x + sx, p.y); ctx.lineTo(p.x + sx, p2.y); ctx.stroke();
                }
                for (let sy = 0; sy < dh; sy += step) {
                    ctx.beginPath(); ctx.moveTo(p.x, p.y + sy); ctx.lineTo(p2.x, p.y + sy); ctx.stroke();
                }
            }

            // ラベル（ズームに応じて詳細度を変える）
            const fs = Math.max(9, Math.min(14, 11 * cam.zoom));
            ctx.font = `bold ${fs}px 'SF Mono', monospace`;
            const labelText = d.uuid.replace(/^display:/, "").slice(0, 16);
            if (dw > 50) {
                ctx.fillStyle = isSel ? col : col + "cc";
                ctx.fillText(labelText, p.x + 6, p.y + fs + 4);
            }
            if (dh > 36 && dw > 80 && cam.zoom > 0.15) {
                ctx.font = `${Math.max(8, fs - 2)}px monospace`;
                ctx.fillStyle = "rgba(255,255,255,0.55)";
                ctx.fillText(`${vp.x},${vp.y}  ${vp.width}×${vp.height}  ×${vp.scale.toFixed(2)}`, p.x + 6, p.y + fs * 2 + 6);
            }

            // ARインジケーター（右下角）
            if (isSel && d.screenW) {
                const arStr = `${d.screenW}×${d.screenH}`;
                ctx.font = `${Math.max(7, fs - 3)}px monospace`;
                ctx.fillStyle = arLocked ? "#00d4ff80" : "#ffffff40";
                ctx.fillText(arStr, p2.x - ctx.measureText(arStr).width - 5, p2.y - 5);
            }

            if (d.testPattern !== "off") {
                ctx.fillStyle = "rgba(255,220,0,0.9)";
                ctx.font = `bold ${Math.max(8, fs - 1)}px sans-serif`;
                ctx.fillText(`🧪 ${d.testPattern}`, p.x + 6, p2.y - 6);
            }

            // --- リサイズハンドル（選択中のみ） ---
            if (isSel) {
                const handles = getHandles(vp);
                const CURSOR_MAP: Record<HandleType, string> = {
                    move: "move", tl: "nw-resize", t: "n-resize", tr: "ne-resize",
                    r: "e-resize", br: "se-resize", b: "s-resize", bl: "sw-resize", l: "w-resize",
                };
                (Object.entries(handles) as [HandleType, { x: number; y: number }][]).forEach(([ht, wpos]) => {
                    if (ht === "move") return;
                    const hp = worldToCanvas(wpos.x, wpos.y);
                    // ハンドル白丸
                    ctx.beginPath();
                    ctx.arc(hp.x, hp.y, HANDLE_R + 1, 0, Math.PI * 2);
                    ctx.fillStyle = "rgba(0,0,0,0.3)";
                    ctx.fill();
                    ctx.beginPath();
                    ctx.arc(hp.x, hp.y, HANDLE_R, 0, Math.PI * 2);
                    ctx.fillStyle = "#ffffff";
                    ctx.fill();
                    ctx.strokeStyle = col;
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    void CURSOR_MAP[ht]; // 型エラー防止（実際はmousemove側でcursor変更）
                });
            }
        });

        // --- スナップガイドライン（ドラッグ中に他ディスプレイの辺と整列している場合） ---
        const sg = snapGuides.current;
        if (sg.x !== undefined) {
            const px = worldToCanvas(sg.x, 0).x;
            ctx.strokeStyle = "rgba(0,212,255,0.8)";
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, CH); ctx.stroke();
            ctx.setLineDash([]);
        }
        if (sg.y !== undefined) {
            const py = worldToCanvas(0, sg.y).y;
            ctx.strokeStyle = "rgba(0,212,255,0.8)";
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(CW, py); ctx.stroke();
            ctx.setLineDash([]);
        }

        // --- フッター (zoom/world info) ---
        ctx.fillStyle = "rgba(100,150,255,0.35)";
        ctx.font = "10px monospace";
        ctx.textBaseline = "bottom";
        ctx.fillText(
            `zoom: ${(cam.zoom * 100).toFixed(0)}%  world: ${worldW}×${worldH}  Space+drag: pan  Shift: 10px snap  F: fit  Esc: 選択解除`,
            RULER + 4, CH - 4
        );
    }, [worldToCanvas, selected, hovered, worldW, worldH, arLocked]);

    // stateが変わったらdrawスケジュール
    useEffect(() => {
        drawRef.current = draw;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(draw);
    }, [draw, displaysSt]);

    // ---- Fit (F キー or ボタン) ----
    const fitView = useCallback(() => {
        const { w: CW, h: CH } = canvasSize();
        const RULER = 20;
        const z = Math.min((CW - RULER) / worldW, (CH - RULER) / worldH) * 0.88;
        camRef.current = {
            panX: RULER + ((CW - RULER) - worldW * z) / 2,
            panY: RULER + ((CH - RULER) - worldH * z) / 2,
            zoom: z,
        };
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(draw);
    }, [canvasSize, draw, worldW, worldH]);

    useEffect(() => { fitView(); }, [fitView]);

    // ---- キーイベント ----
    useEffect(() => {
        const kd = (e: KeyboardEvent) => {
            if (e.code === "Space") { spaceRef.current = true; e.preventDefault(); }
            if (e.code === "KeyF") fitView();
            if (e.code === "Escape") setSelected(null);
        };
        const ku = (e: KeyboardEvent) => { if (e.code === "Space") spaceRef.current = false; };
        window.addEventListener("keydown", kd);
        window.addEventListener("keyup", ku);
        return () => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); };
    }, [fitView]);

    /**
     * ResizeObserver — canvas.width/height を CSSピクセル幅に常に同期。
     * これがないと e.clientX - rect.left が canvas pixel とずれ、
     * マウス座標が横にずれる原因になる。
     */
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const observer = new ResizeObserver(() => {
            const rect = canvas.getBoundingClientRect();
            if (canvas.width !== Math.round(rect.width) || canvas.height !== Math.round(rect.height)) {
                canvas.width = Math.round(rect.width);
                canvas.height = Math.round(rect.height);
                if (rafRef.current) cancelAnimationFrame(rafRef.current);
                rafRef.current = requestAnimationFrame(draw);
            }
        });
        observer.observe(canvas);
        return () => observer.disconnect();
    }, [draw]);

    /**
     * CSS座標→canvas座標変換。
     * canvas.width == canvas.offsetWidthでない場合にスケールされるが、
     * ResizeObserverのおかげで常に1:1のはず。
     */
    const getCanvasPt = useCallback((clientX: number, clientY: number): { mx: number; my: number } => {
        const canvas = canvasRef.current;
        if (!canvas) return { mx: clientX, my: clientY };
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            mx: (clientX - rect.left) * scaleX,
            my: (clientY - rect.top) * scaleY,
        };
    }, []);

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

    // ---- キーボードショートカット (Undo/Redo) ----
    useEffect(() => {
        const handler = (e: KeyboardEvent): void => {
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "z") { e.preventDefault(); undo(); }
            if ((e.metaKey || e.ctrlKey) && (e.shiftKey && e.key === "z" || e.key === "y")) { e.preventDefault(); redo(); }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [undo, redo]);

    // ---- マウスイベント ----
    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const { mx, my } = getCanvasPt(e.clientX, e.clientY);

        if (spaceRef.current || e.button === 1) {
            isPanningRef.current = true;
            panStartRef.current = { mx, my, px: camRef.current.panX, py: camRef.current.panY };
            return;
        }

        const wp = canvasToWorld(mx, my);

        if (selected) {
            const d = displaysRef.current.find(d => d.uuid === selected);
            if (d?.viewport) {
                const h = hitHandle(mx, my, d.viewport);
                if (h) {
                    // ドラッグ開始前にUndoスタックに保存
                    undoStackRef.current.push(snapshotViewports());
                    redoStackRef.current = []; // 新しい操作後はredoをクリア
                    dragRef.current = { handle: h, uuid: d.uuid, startMouseX: mx, startMouseY: my, startVp: { ...d.viewport } };
                    return;
                }
            }
        }

        for (const d of [...displaysRef.current].reverse()) {
            const vp = d.viewport;
            if (!vp) continue;
            if (wp.x >= vp.x && wp.x <= vp.x + vp.width && wp.y >= vp.y && wp.y <= vp.y + vp.height) {
                setSelected(d.uuid);
                // ドラッグ開始前にUndoスタックに保存
                undoStackRef.current.push(snapshotViewports());
                redoStackRef.current = [];
                dragRef.current = { handle: "move", uuid: d.uuid, startMouseX: mx, startMouseY: my, startVp: { ...vp } };
                return;
            }
        }
        setSelected(null);
    }, [selected, hitHandle, canvasToWorld, getCanvasPt, snapshotViewports]);

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const { mx, my } = getCanvasPt(e.clientX, e.clientY);

        // パン
        if (isPanningRef.current) {
            camRef.current.panX = panStartRef.current.px + (mx - panStartRef.current.mx);
            camRef.current.panY = panStartRef.current.py + (my - panStartRef.current.my);
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(draw);
            return;
        }

        if (!dragRef.current) {
            // ---- ホバー判定（ドラッグ中以外）----
            const wp2 = canvasToWorld(mx, my);
            let newHov: string | null = null;
            let cursorStyle = "default";

            // pointer_move 送信
            const now = Date.now();
            if (now - pointerThrottleRef.current >= 50) {
                pointerThrottleRef.current = now;
                ws.send({ event: "pointer_move", x: Math.round(wp2.x), y: Math.round(wp2.y) });
            }

            if (selected) {
                const selD = displaysRef.current.find(d => d.uuid === selected);
                if (selD?.viewport) {
                    const h = hitHandle(mx, my, selD.viewport);
                    if (h) {
                        const CURSOR_MAP: Record<HandleType, string> = {
                            move: "move", tl: "nw-resize", t: "n-resize", tr: "ne-resize",
                            r: "e-resize", br: "se-resize", b: "s-resize", bl: "sw-resize", l: "w-resize",
                        };
                        cursorStyle = CURSOR_MAP[h];
                        newHov = selD.uuid;
                    }
                }
            }
            if (!newHov) {
                for (const d of [...displaysRef.current].reverse()) {
                    const vp = d.viewport;
                    if (!vp) continue;
                    if (wp2.x >= vp.x && wp2.x <= vp.x + vp.width && wp2.y >= vp.y && wp2.y <= vp.y + vp.height) {
                        newHov = d.uuid;
                        cursorStyle = "pointer";
                        break;
                    }
                }
            }
            if (canvasRef.current) canvasRef.current.style.cursor = spaceRef.current ? "grab" : cursorStyle;
            if (newHov !== hoveredRef.current) {
                hoveredRef.current = newHov;
                setHovered(newHov); // React rerenderでdrawが走る
            }
            return;
        }
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
        // arLocked がオンなら screenW/H からARを算出して一方の辺を追従させる
        if (handle !== "move" && arLocked) {
            const dInfo = displaysRef.current.find(d => d.uuid === uuid);
            if (dInfo?.screenW && dInfo?.screenH) {
                const ar = dInfo.screenW / dInfo.screenH;
                if (handle === "t" || handle === "b") {
                    newVp.width = Math.max(minSize, Math.round(newVp.height * ar));
                } else {
                    newVp.height = Math.max(minSize, Math.round(newVp.width / ar));
                }
                if (handle === "tl" || handle === "tr" || handle === "t") {
                    newVp.y = startVp.y + startVp.height - newVp.height;
                }
                if (handle === "l" || handle === "bl" || handle === "tl") {
                    newVp.x = startVp.x + startVp.width - newVp.width;
                }
                newVp.scale = parseFloat((dInfo.screenW / newVp.width).toFixed(3));
            }
        }

        // ---- スナップガイド（他ディスプレイの辺に8ワール座標内で吸着） ----
        const SNAP_DIST = 8; // world units
        const others = displaysRef.current.filter(d => d.uuid !== uuid && d.viewport);
        let snappedX: number | undefined;
        let snappedY: number | undefined;

        if (handle === "move" || handle === "l" || handle === "bl" || handle === "tl") {
            // 左辺のスナップ
            for (const o of others) {
                const ov = o.viewport!;
                if (Math.abs(newVp.x - ov.x) < SNAP_DIST) { newVp.x = ov.x; snappedX = ov.x; break; }
                if (Math.abs(newVp.x - (ov.x + ov.width)) < SNAP_DIST) { newVp.x = ov.x + ov.width; snappedX = ov.x + ov.width; break; }
            }
        }
        if (handle === "move" || handle === "r" || handle === "br" || handle === "tr") {
            // 右辺のスナップ
            for (const o of others) {
                const ov = o.viewport!;
                const right = newVp.x + newVp.width;
                if (Math.abs(right - ov.x) < SNAP_DIST) { newVp.x = ov.x - newVp.width; snappedX = ov.x; break; }
                if (Math.abs(right - (ov.x + ov.width)) < SNAP_DIST) { newVp.x = ov.x + ov.width - newVp.width; snappedX = ov.x + ov.width; break; }
            }
        }
        if (handle === "move" || handle === "t" || handle === "tl" || handle === "tr") {
            for (const o of others) {
                const ov = o.viewport!;
                if (Math.abs(newVp.y - ov.y) < SNAP_DIST) { newVp.y = ov.y; snappedY = ov.y; break; }
                if (Math.abs(newVp.y - (ov.y + ov.height)) < SNAP_DIST) { newVp.y = ov.y + ov.height; snappedY = ov.y + ov.height; break; }
            }
        }
        if (handle === "move" || handle === "b" || handle === "bl" || handle === "br") {
            for (const o of others) {
                const ov = o.viewport!;
                const bottom = newVp.y + newVp.height;
                if (Math.abs(bottom - ov.y) < SNAP_DIST) { newVp.y = ov.y - newVp.height; snappedY = ov.y; break; }
                if (Math.abs(bottom - (ov.y + ov.height)) < SNAP_DIST) { newVp.y = ov.y + ov.height - newVp.height; snappedY = ov.y + ov.height; break; }
            }
        }
        snapGuides.current = { x: snappedX, y: snappedY };

        displaysRef.current = displaysRef.current.map(d => d.uuid !== uuid ? d : { ...d, viewport: newVp });
        // RAFでcanvasを再描画（60fps）
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(draw);

        // ---- VP_preview: throttle 100ms で displayにリアルタイム送信 ----
        const now = Date.now();
        if (now - previewThrottleRef.current >= 100) {
            previewThrottleRef.current = now;
            ws.send({ event: "viewport_preview", displayUuid: uuid, viewport: newVp });
        }
    }, [draw, arLocked]);

    const handleMouseUp = useCallback(() => {
        isPanningRef.current = false;
        snapGuides.current = {};  // スナップガイドをクリア
        if (!dragRef.current) return;
        const { uuid } = dragRef.current;
        dragRef.current = null;
        // React stateに同期してサイドパネルを更新
        setDisplaysSt([...displaysRef.current]);

        const moved = displaysRef.current.find(d => d.uuid === uuid);
        if (!moved?.viewport) return;
        const savedVp = { ...moved.viewport };

        // pendingに登録された時点で、次のclent_list pushで上書きされないようにする
        pendingViewports.current.set(uuid, savedVp);

        // サーバーに保存（PUT完了後には pending から削除）
        void fetch(`/api/clients/${encodeURIComponent(uuid)}/viewport`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(savedVp),
        }).finally(() => {
            // PUT完了後はpendingを删除してサーバーの値を許可する
            pendingViewports.current.delete(uuid);
        });
    }, []);


    const selDisplay = displaysSt.find(d => d.uuid === selected);
    const [sidebarTab, setSidebarTab] = useState<"prop" | "list">("list");
    // マウス座標表示用はstate（ステータスバー用）
    const [mouseWorld, setMouseWorld] = useState<{ x: number; y: number } | null>(null);

    // マウス移動時にワール座標を取得（ステータスバー表示用）
    const handleMouseMoveWithCoord = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        handleMouseMove(e);
        const { mx, my } = getCanvasPt(e.clientX, e.clientY);
        const wp = canvasToWorld(mx, my);
        setMouseWorld({ x: Math.round(wp.x), y: Math.round(wp.y) });
    }, [handleMouseMove, getCanvasPt, canvasToWorld]);

    // 選択変更時にサイドバーをプロパティタブに切り替え
    const handleSelectDisplay = useCallback((uuid: string) => {
        setSelected(uuid);
        setSidebarTab("prop");
    }, []);

    return (
        <div className="layout-tab">
            {/* コンパクトツールバー */}
            <div className="layout-toolbar">
                <span className="toolbar-label">🌐 World:</span>
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
                <div className="toolbar-sep" />
                {([
                    [3840, 1080, "4K横2面"], [3840, 2160, "4K縦2面"], [1920, 1080, "FHD"], [5760, 1080, "横3面"],
                ] as [number, number, string][]).map(([w, h, label]) => (
                    <button key={label} className="btn btn-sm btn-secondary"
                        onClick={() => { setWorldW(w); setWorldH(h); }}>
                        {label}
                    </button>
                ))}
                <div className="toolbar-sep" />
                <button className="btn btn-sm btn-secondary" onClick={fitView} title="Fキー">
                    🔍 Fit
                </button>
                <button
                    className={`btn btn-sm ${arLocked ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setArLocked(v => !v)}
                    title="ARロック: displayの内側展開 sizeからARを固定"
                >
                    {arLocked ? "🔒 AR" : "🔓 AR"}
                </button>
                <div className="toolbar-sep" />
                {/* テストパターン一括送信 */}
                <span className="toolbar-label">🧪 全画面:</span>
                {(["off", "grid", "colorbars", "crosshair", "white", "black", "worldmap", "calibration"] as TestPattern[]).map((p) => (
                    <button key={p} className="btn btn-sm btn-pattern"
                        onClick={() => void onTestPattern(p)}>
                        {{
                            off: "⬛ OFF", grid: "# Grid", colorbars: "🎨 Color",
                            crosshair: "⊝ Cross", white: "◻ White", black: "◼ Black",
                            worldmap: "🗺 World", calibration: "🔢 Cal",
                        }[p]}
                    </button>
                ))}
            </div>

            {/* メインエリア: Canvas + Sidebar */}
            <div className="layout-main">
                {/* Canvas エリア */}
                <div className="layout-canvas-area">
                    <canvas
                        ref={canvasRef}
                        className="layout-canvas"
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMoveWithCoord}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={() => { handleMouseUp(); setMouseWorld(null); }}
                        onWheel={handleWheel}
                    />
                </div>

                {/* 右サイドバー */}
                <div className="layout-sidebar">
                    {/* トグルタブ */}
                    <div className="sidebar-tabs">
                        <button
                            className={`sidebar-tab ${sidebarTab === "list" ? "active" : ""}`}
                            onClick={() => setSidebarTab("list")}>
                            🗋 一覧 ({displaysSt.length})
                        </button>
                        <button
                            className={`sidebar-tab ${sidebarTab === "prop" ? "active" : ""}`}
                            onClick={() => setSidebarTab("prop")}>
                            ⚙️ プロパティ
                        </button>
                    </div>

                    {/* サイドバー 本文 */}
                    <div className="sidebar-body">
                        {sidebarTab === "list" && (
                            <>
                                {displaysSt.length === 0 ? (
                                    <div className="sidebar-empty">
                                        <div className="sidebar-empty-icon">🖥</div>
                                        <p>接続中のディスプレイなし</p>
                                        <p style={{ fontSize: "0.75rem", marginTop: 8 }}>
                                            新しいタブで&nbsp;
                                            <a href="/display" target="_blank" style={{ color: "#7ec8e3" }}>/display</a>
                                            &nbsp;を開いてください
                                        </p>
                                    </div>
                                ) : (
                                    displaysSt.map((d: DisplayClientInfo, i: number) => {
                                        const color = COLORS[i % COLORS.length];
                                        const secsSince = Math.round((Date.now() - d.lastSeen) / 1000);
                                        return (
                                            <div
                                                key={d.uuid}
                                                className={`display-list-item ${selected === d.uuid ? "active" : ""}`}
                                                style={{ borderLeftColor: color }}
                                                onClick={() => handleSelectDisplay(d.uuid)}
                                            >
                                                <div className="display-list-dot" style={{ background: color }} />
                                                <div className="display-list-info">
                                                    <div className="display-list-id">
                                                        {d.uuid.replace(/^display:/, "")}
                                                    </div>
                                                    <div className="display-list-meta">
                                                        {d.viewport
                                                            ? `${d.viewport.x},${d.viewport.y} | ${d.viewport.width}×${d.viewport.height} ×${d.viewport.scale.toFixed(2)}`
                                                            : "Viewport未設定"}
                                                    </div>
                                                    <div className="display-list-meta">
                                                        {d.screenW ? `📱 ${d.screenW}×${d.screenH}` : ""}&nbsp;
                                                        {secsSince < 10 ? "🟢" : secsSince < 30 ? "🟡" : "🔴"} {secsSince}s
                                                        {d.testPattern !== "off" && <span className="display-list-badge"> 🧪{d.testPattern}</span>}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                                <div style={{ marginTop: 12 }}>
                                    <a className="btn btn-sm btn-secondary" style={{ width: "100%", justifyContent: "center" }}
                                        href="/display" target="_blank">
                                        + ディスプレイを追加
                                    </a>
                                </div>
                            </>
                        )}

                        {sidebarTab === "prop" && (
                            selDisplay ? (
                                <DisplayPanel
                                    key={selDisplay.uuid}
                                    display={selDisplay}
                                    displayColor={COLORS[displaysSt.indexOf(selDisplay) % COLORS.length]}
                                    onSave={async (vp) => {
                                        displaysRef.current = displaysRef.current.map(d =>
                                            d.uuid !== selDisplay.uuid ? d : { ...d, viewport: vp }
                                        );
                                        setDisplaysSt([...displaysRef.current]);
                                        if (rafRef.current) cancelAnimationFrame(rafRef.current);
                                        rafRef.current = requestAnimationFrame(draw);
                                        await onSaveViewport(selDisplay.uuid, vp);
                                    }}
                                    onPreviewViewport={(vp) => {
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
                                    <div className="sidebar-empty-icon">↖️</div>
                                    <p>Canvas上のディスプレイを</p>
                                    <p>クリックして選択</p>
                                </div>
                            )
                        )}
                    </div>
                </div>
            </div>

            {/* ステータスバー */}
            <div className="layout-statusbar">
                <span className="statusbar-item">
                    🔍 {(camRef.current.zoom * 100).toFixed(0)}%
                </span>
                <span className="statusbar-item">
                    🌐 {worldW}×{worldH}
                </span>
                {mouseWorld && (
                    <span className="statusbar-item">
                        📍 ({mouseWorld.x}, {mouseWorld.y})
                    </span>
                )}
                {selected && (
                    <span className="statusbar-item">
                        ✅ {selected.replace(/^display:/, "")}
                    </span>
                )}
                <span className="statusbar-item" style={{ marginLeft: "auto" }}>
                    Space+drag: pan ┃ Wheel: zoom ┃ Shift: 10px snap ┃ F: fit ┃ Esc: 選択解除
                </span>
            </div>
        </div>
    );
}

// -------- 選択ディスプレイパネル ----------------------------
function DisplayPanel({
    display,
    displayColor,
    onSave,
    onPreviewViewport,
    onTestPattern,
}: {
    display: DisplayClientInfo;
    displayColor: string;
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
                    {(["off", "grid", "colorbars", "crosshair", "white", "black", "worldmap", "calibration"] as TestPattern[]).map((p) => (
                        <button
                            key={p}
                            className={`btn btn-pattern ${display.testPattern === p ? "active" : ""}`}
                            onClick={() => void onTestPattern(p)}
                        >
                            {{ off: "\u2b1b オフ", grid: "# グリッド", colorbars: "\ud83c\udfa8 カラーバー", crosshair: "\u229d 十字", white: "\u25fb 白", black: "\u25fc 黒", worldmap: "\ud83d\uddfa ワールドマップ", calibration: "\ud83d\udd22 キャリブ" }[p]}
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
