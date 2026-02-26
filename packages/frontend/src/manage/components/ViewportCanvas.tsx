import React, { useRef, useEffect, useCallback, useState } from "react";
import type { DisplayClientInfo } from "@aquarium/shared";
import { ws } from "../main";

interface ViewportCanvasProps {
    worldW: number;
    worldH: number;
    displaysSt: DisplayClientInfo[];
    displaysRef: React.MutableRefObject<DisplayClientInfo[]>;
    pendingViewports: React.MutableRefObject<Map<string, NonNullable<DisplayClientInfo["viewport"]>>>;
    selected: string | null;
    setSelected: (id: string | null) => void;
    hoveredRef: React.MutableRefObject<string | null>;
    setHoveredUI: (id: string | null) => void;
    undoStackRef: React.MutableRefObject<any[]>; // 複雑なのでanyで
    redoStackRef: React.MutableRefObject<any[]>;
    snapshotViewports: () => any[];
    onSaveViewport: (uuid: string, vp: NonNullable<DisplayClientInfo["viewport"]>) => Promise<void>;
    arLocked: boolean;
    sendRateSetting: number;
    setWorldSize: (w: number, h: number) => void;
    forbiddenZones: { id: string; x: number; y: number; width: number; height: number }[];
    onUpdateForbiddenZones: (zones: { id: string; x: number; y: number; width: number; height: number }[]) => void;
    spawnPoints: { id: string; x: number; y: number }[];
    onUpdateSpawnPoints: (points: { id: string; x: number; y: number }[]) => void;
}

// ハンドルの種類（8点＋ボディ移動＋Worldリサイズ用）
type HandleType = "tl" | "t" | "tr" | "r" | "br" | "b" | "bl" | "l" | "move" | "world_br" | `fz_${string}` | `sp_${string}`;
interface Camera { panX: number; panY: number; zoom: number; }
interface DragState {
    handle: HandleType;
    uuid: string; // display uuid または fz id
    startMouseX: number; startMouseY: number;
    startRect: { x: number; y: number; width: number; height: number; scale?: number };
}

const HANDLE_R = 6;
const COLORS = ["#10b981"]; // Emerald 500 (全て緑色で統一)

function getHandles(vp: { x: number; y: number; width: number; height: number; }): any {
    const { x, y, width: w, height: h } = vp;
    return {
        move: { x: x + w / 2, y: y + h / 2 },
        // ... (省略)
        tl: { x, y }, t: { x: x + w / 2, y }, tr: { x: x + w, y },
        r: { x: x + w, y: y + h / 2 }, br: { x: x + w, y: y + h },
        b: { x: x + w / 2, y: y + h }, bl: { x, y: y + h },
        l: { x, y: y + h / 2 },
    };
}

export function ViewportCanvas({
    worldW, worldH, displaysSt, displaysRef, pendingViewports,
    selected, setSelected, hoveredRef, setHoveredUI,
    undoStackRef, redoStackRef, snapshotViewports, onSaveViewport,
    arLocked, sendRateSetting, setWorldSize, forbiddenZones, onUpdateForbiddenZones,
    spawnPoints, onUpdateSpawnPoints
}: ViewportCanvasProps): React.ReactElement {

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<DragState | null>(null);
    const camRef = useRef<Camera>({ panX: 0, panY: 0, zoom: 1 });
    const rafRef = useRef<number | null>(null);
    const isPanningRef = useRef(false);
    const panStartRef = useRef({ mx: 0, my: 0, px: 0, py: 0 });
    const spaceRef = useRef(false);
    const drawRef = useRef<() => void>(() => void 0);

    const previewThrottleRef = useRef<number>(0);
    const pointerThrottleRef = useRef<number>(0);
    const snapGuides = useRef<{ x?: number; y?: number }>({});
    const pendingWorldSizeRef = useRef<{ w: number, h: number } | null>(null);

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

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const { w: CW, h: CH } = canvasSize();
        const cam = camRef.current;

        ctx.clearRect(0, 0, CW, CH);

        // 背景チェッカーボード (Canvas領域全体の背景)
        ctx.fillStyle = "#f8fafc"; // slate-50
        ctx.fillRect(0, 0, CW, CH);
        const CHECKER = 24;
        ctx.fillStyle = "rgba(0, 0, 0, 0.03)";
        for (let cx2 = 0; cx2 < CW; cx2 += CHECKER * 2) {
            for (let cy2 = 0; cy2 < CH; cy2 += CHECKER * 2) {
                ctx.fillRect(cx2, cy2, CHECKER, CHECKER);
                ctx.fillRect(cx2 + CHECKER, cy2 + CHECKER, CHECKER, CHECKER);
            }
        }

        // ワールド矩形
        const wDraw = pendingWorldSizeRef.current?.w ?? worldW;
        const hDraw = pendingWorldSizeRef.current?.h ?? worldH;
        const tl = worldToCanvas(0, 0);
        const br = worldToCanvas(wDraw, hDraw);
        const ww = br.x - tl.x, wh = br.y - tl.y;
        ctx.shadowColor = "rgba(0, 0, 0, 0.05)";
        ctx.shadowBlur = 10;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(tl.x, tl.y, ww, wh);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "#e2e8f0"; // slate-200
        ctx.lineWidth = 1;
        ctx.strokeRect(tl.x + 0.5, tl.y + 0.5, ww - 1, wh - 1);

        // ---キャンバスリサイズ用のハンドル（World Size）---
        ctx.fillStyle = "#f59e0b"; // amber-500
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        const R = 8;
        ctx.beginPath();
        ctx.arc(br.x, br.y, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // ---キャンバスリサイズ用のハンドルここまで---

        // グリッド
        const GRID = 100, MAJ = 500;
        const wx0 = Math.floor(-cam.panX / cam.zoom / GRID) * GRID;
        const wy0 = Math.floor(-cam.panY / cam.zoom / GRID) * GRID;

        ctx.lineWidth = 0.5;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.04)";
        for (let x = wx0; x < wx0 + CW / cam.zoom + GRID * 2; x += GRID) {
            if (x < 0 || x > wDraw) continue;
            const px = worldToCanvas(x, 0).x;
            ctx.beginPath(); ctx.moveTo(px, tl.y); ctx.lineTo(px, br.y); ctx.stroke();
        }
        for (let y = wy0; y < wy0 + CH / cam.zoom + GRID * 2; y += GRID) {
            if (y < 0 || y > hDraw) continue;
            const py = worldToCanvas(0, y).y;
            ctx.beginPath(); ctx.moveTo(tl.x, py); ctx.lineTo(br.x, py); ctx.stroke();
        }
        // メジャーグリッド
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.08)";
        for (let x = 0; x <= wDraw; x += MAJ) {
            const px = worldToCanvas(x, 0).x;
            ctx.beginPath(); ctx.moveTo(px, tl.y); ctx.lineTo(px, br.y); ctx.stroke();
        }
        for (let y = 0; y <= hDraw; y += MAJ) {
            const py = worldToCanvas(0, y).y;
            ctx.beginPath(); ctx.moveTo(tl.x, py); ctx.lineTo(br.x, py); ctx.stroke();
        }

        // ルーラー
        const RULER = 20;
        ctx.fillStyle = "rgba(241, 245, 249, 0.9)"; // slate-100
        ctx.fillRect(0, 0, CW, RULER);
        ctx.fillRect(0, 0, RULER, CH);
        ctx.strokeStyle = "#cbd5e1"; // slate-300
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, RULER); ctx.lineTo(CW, RULER); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(RULER, 0); ctx.lineTo(RULER, CH); ctx.stroke();

        ctx.fillStyle = "#64748b"; // slate-500
        ctx.font = `${Math.max(8, 7 * cam.zoom)}px monospace`;
        ctx.textBaseline = "top";
        for (let x = 0; x <= wDraw; x += MAJ) {
            const px = worldToCanvas(x, 0).x;
            if (px < RULER || px > CW) continue;
            ctx.fillText(String(x), px + 2, 3);
            ctx.strokeStyle = "#94a3b8"; // slate-400
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(px, RULER - 4); ctx.lineTo(px, RULER); ctx.stroke();
        }
        for (let y = 0; y <= hDraw; y += MAJ) {
            const py = worldToCanvas(0, y).y;
            if (py < RULER || py > CH) continue;
            ctx.save();
            ctx.translate(3, py + 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(String(y), 0, 0);
            ctx.restore();
            ctx.strokeStyle = "#94a3b8";
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(RULER - 4, py); ctx.lineTo(RULER, py); ctx.stroke();
        }

        // ディスプレイ描画
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

            ctx.fillStyle = isSel ? col + "40" : isHov ? col + "28" : col + "14";
            ctx.fillRect(p.x, p.y, dw, dh);
            ctx.shadowBlur = 0;

            ctx.strokeStyle = isSel ? col : isHov ? col + "aa" : col + "88";
            ctx.lineWidth = isSel ? 2 : 1.5;
            ctx.strokeRect(p.x, p.y, dw, dh);

            ctx.fillStyle = isSel ? "#0f172a" : "#334155";
            ctx.font = `bold ${Math.max(10, 12 * cam.zoom)}px sans-serif`;
            ctx.textBaseline = "bottom";
            ctx.fillText(`ID: ${d.uuid.split(":")[1] || d.uuid}`, p.x + 4, p.y + dh - 4);

            const whText = `${Math.round(vp.width)}×${Math.round(vp.height)}`;
            ctx.font = `${Math.max(9, 10 * cam.zoom)}px monospace`;
            ctx.fillText(whText, p.x + 4, p.y + dh - 18 * cam.zoom);

            if (isSel) {
                ctx.fillStyle = "#fff";
                ctx.strokeStyle = col;
                ctx.lineWidth = 1.5;
                const pts = getHandles(vp);
                type VpHandleType = Exclude<HandleType, "world_br" | "move">;
                (["tl", "t", "tr", "r", "br", "b", "bl", "l"] as VpHandleType[]).forEach((ht) => {
                    const cp = worldToCanvas(pts[ht].x, pts[ht].y);
                    ctx.beginPath(); ctx.arc(cp.x, cp.y, HANDLE_R, 0, Math.PI * 2);
                    ctx.fill(); ctx.stroke();
                });
            }
        });

        // スナップライン描画
        const sg = snapGuides.current;
        if (sg.x !== undefined || sg.y !== undefined) {
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = "#f39c12"; // オレンジ色
            ctx.lineWidth = 1;
            ctx.beginPath();
            if (sg.x !== undefined) {
                const cx = worldToCanvas(sg.x, 0).x;
                ctx.moveTo(cx, 0); ctx.lineTo(cx, CH);
            }
            if (sg.y !== undefined) {
                const cy = worldToCanvas(0, sg.y).y;
                ctx.moveTo(0, cy); ctx.lineTo(CW, cy);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // 進入禁止エリア描画
        forbiddenZones.forEach(z => {
            const p = worldToCanvas(z.x, z.y);
            const p2 = worldToCanvas(z.x + z.width, z.y + z.height);
            const dw = p2.x - p.x, dh = p2.y - p.y;
            const isSel = dragRef.current?.uuid === z.id;

            ctx.fillStyle = "rgba(220, 38, 38, 0.15)"; // red-600
            ctx.fillRect(p.x, p.y, dw, dh);

            ctx.strokeStyle = "rgba(220, 38, 38, 0.8)";
            ctx.lineWidth = isSel ? 2 : 1;
            ctx.strokeRect(p.x, p.y, dw, dh);

            ctx.fillStyle = "rgba(153, 27, 27, 0.8)";
            ctx.font = `bold ${Math.max(10, 12 * cam.zoom)}px sans-serif`;
            ctx.textBaseline = "bottom";
            ctx.fillText("FORBIDDEN", p.x + 4, p.y + dh - 4);

            if (isSel) {
                ctx.fillStyle = "#fff";
                ctx.strokeStyle = "rgba(220, 38, 38, 1)";
                ctx.lineWidth = 1.5;
                const pts = getHandles(z as any);
                (["tl", "t", "tr", "r", "br", "b", "bl", "l"] as Exclude<HandleType, "world_br" | "move" | `fz_${string}` | `sp_${string}`>[]).forEach((ht) => {
                    const cp = worldToCanvas(pts[ht].x, pts[ht].y);
                    ctx.beginPath(); ctx.arc(cp.x, cp.y, HANDLE_R, 0, Math.PI * 2);
                    ctx.fill(); ctx.stroke();
                });
            }
        });

        // 放流ポイント描画
        spawnPoints.forEach(sp => {
            const p = worldToCanvas(sp.x, sp.y);
            const isSel = dragRef.current?.uuid === sp.id;

            ctx.fillStyle = isSel ? "#0284c7" : "#38bdf8"; // sky-600 vs sky-400
            ctx.beginPath();
            ctx.arc(p.x, p.y, HANDLE_R * 1.5, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = "#fff";
            ctx.font = `bold ${Math.max(10, 14 * cam.zoom)}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("✨", p.x, p.y);
            // reset
            ctx.textAlign = "left";
        });

        // --- 魚のリアルタイム位置ポインタ描画 ---
        const frame = (window as any).__lastFrame;
        if (frame && frame.f) {
            frame.f.forEach((f: any) => {
                const pt = worldToCanvas(f.x, f.y);
                const layerColors = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4"];
                const zIndexGroup = Math.floor(f.z / 10) % layerColors.length;

                // 点(ドット)を描画
                ctx.fillStyle = layerColors[zIndexGroup];
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, Math.max(2, 4 * cam.zoom), 0, Math.PI * 2);
                ctx.fill();

                // Z-indexとIDを色付きの文字で小さく描画
                ctx.font = "8px monospace";
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                ctx.fillText(f.i, pt.x + 8, pt.y);
            });
        }
    }, [selected, worldW, worldH, canvasSize, worldToCanvas, forbiddenZones, spawnPoints, pendingWorldSizeRef]);

    drawRef.current = draw;

    // 初期カメラ計算
    useEffect(() => {
        if (!canvasRef.current || !wrapperRef.current) return;
        const cw = wrapperRef.current.clientWidth;
        const ch = wrapperRef.current.clientHeight;
        canvasRef.current.width = cw;
        canvasRef.current.height = ch;

        // Fit to World
        camRef.current.zoom = Math.min((cw - 100) / worldW, (ch - 100) / worldH);
        camRef.current.panX = (cw - worldW * camRef.current.zoom) / 2;
        camRef.current.panY = (ch - worldH * camRef.current.zoom) / 2;
        draw();

        const ro = new ResizeObserver((entries) => {
            for (const ent of entries) {
                canvasRef.current!.width = ent.contentRect.width;
                canvasRef.current!.height = ent.contentRect.height;
                draw();
            }
        });
        ro.observe(wrapperRef.current);
        return () => ro.disconnect();
    }, [worldW, worldH, draw]);

    // Request Animation Frame描画トリガー (displaysの更新時など)
    useEffect(() => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(draw);
    }, [displaysSt, draw]);

    // 魚のリアルタイム情報受信時の再描画トリガー
    useEffect(() => {
        const onFrame = () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(draw);
        };
        window.addEventListener("aquarium_frame", onFrame);
        return () => window.removeEventListener("aquarium_frame", onFrame);
    }, [draw]);

    // マウスイベント処理
    const getCanvasPt = useCallback((evtX: number, evtY: number) => {
        const rect = canvasRef.current!.getBoundingClientRect();
        return { mx: evtX - rect.left, my: evtY - rect.top };
    }, []);

    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (e.button === 1 || spaceRef.current) {
            isPanningRef.current = true;
            const { mx, my } = getCanvasPt(e.clientX, e.clientY);
            panStartRef.current = { mx, my, px: camRef.current.panX, py: camRef.current.panY };
            canvasRef.current!.style.cursor = "grabbing";
            return;
        }

        const { mx, my } = getCanvasPt(e.clientX, e.clientY);
        const wPt = canvasToWorld(mx, my);

        // 新規追加 (右クリドラッグでForbiddenZone)
        if (e.button === 2) {
            const newZone = { id: `fz_${Date.now()}_${Math.random().toString(36).slice(2)}`, x: wPt.x, y: wPt.y, width: 0, height: 0 };
            onUpdateForbiddenZones([...forbiddenZones, newZone]);
            dragRef.current = { handle: "fz_br", uuid: newZone.id, startMouseX: mx, startMouseY: my, startRect: { ...newZone } };
            setSelected(null);
            return;
        }

        if (e.button !== 0) return;

        // まず World Resizer かどうか判定
        const z = camRef.current.zoom;
        const R_WORLD = 12 / z; // 当たり判定少し大きめ
        const currentWorldW = pendingWorldSizeRef.current?.w ?? worldW;
        const currentWorldH = pendingWorldSizeRef.current?.h ?? worldH;
        if (Math.abs(wPt.x - currentWorldW) <= R_WORLD && Math.abs(wPt.y - currentWorldH) <= R_WORLD) {
            undoStackRef.current.push(snapshotViewports());
            redoStackRef.current.length = 0;
            pendingWorldSizeRef.current = { w: worldW, h: worldH }; // Store current world size for pending updates
            dragRef.current = {
                handle: "world_br", uuid: "world", startMouseX: mx, startMouseY: my,
                startRect: { x: 0, y: 0, width: currentWorldW, height: currentWorldH, scale: 1 }
            };
            return;
        }

        // 既存の禁止エリア（アクティブ判定があればそちらを優先で触らせたいが、今回は普通に後ろから判定）
        for (let i = forbiddenZones.length - 1; i >= 0; i--) {
            const fz = forbiddenZones[i];
            const pts = getHandles(fz as any);
            const HANDLE_R_W = HANDLE_R / z;

            // selectedでなくても触れるようにするか？とりあえず今回はどこでも触ったら選択
            const isSel = dragRef.current?.uuid === fz.id;

            if (Math.abs(wPt.x - pts.br.x) < HANDLE_R_W && Math.abs(wPt.y - pts.br.y) < HANDLE_R_W) { dragRef.current = { handle: "fz_br", uuid: fz.id, startMouseX: mx, startMouseY: my, startRect: { ...fz } }; return; }
            if (Math.abs(wPt.x - pts.tr.x) < HANDLE_R_W && Math.abs(wPt.y - pts.tr.y) < HANDLE_R_W) { dragRef.current = { handle: "fz_tr", uuid: fz.id, startMouseX: mx, startMouseY: my, startRect: { ...fz } }; return; }
            if (Math.abs(wPt.x - pts.bl.x) < HANDLE_R_W && Math.abs(wPt.y - pts.bl.y) < HANDLE_R_W) { dragRef.current = { handle: "fz_bl", uuid: fz.id, startMouseX: mx, startMouseY: my, startRect: { ...fz } }; return; }
            if (Math.abs(wPt.x - pts.tl.x) < HANDLE_R_W && Math.abs(wPt.y - pts.tl.y) < HANDLE_R_W) { dragRef.current = { handle: "fz_tl", uuid: fz.id, startMouseX: mx, startMouseY: my, startRect: { ...fz } }; return; }
            if (Math.abs(wPt.x - pts.r.x) < HANDLE_R_W && Math.abs(wPt.y - pts.r.y) < HANDLE_R_W) { dragRef.current = { handle: "fz_r", uuid: fz.id, startMouseX: mx, startMouseY: my, startRect: { ...fz } }; return; }
            if (Math.abs(wPt.x - pts.l.x) < HANDLE_R_W && Math.abs(wPt.y - pts.l.y) < HANDLE_R_W) { dragRef.current = { handle: "fz_l", uuid: fz.id, startMouseX: mx, startMouseY: my, startRect: { ...fz } }; return; }
            if (Math.abs(wPt.x - pts.b.x) < HANDLE_R_W && Math.abs(wPt.y - pts.b.y) < HANDLE_R_W) { dragRef.current = { handle: "fz_b", uuid: fz.id, startMouseX: mx, startMouseY: my, startRect: { ...fz } }; return; }
            if (Math.abs(wPt.x - pts.t.x) < HANDLE_R_W && Math.abs(wPt.y - pts.t.y) < HANDLE_R_W) { dragRef.current = { handle: "fz_t", uuid: fz.id, startMouseX: mx, startMouseY: my, startRect: { ...fz } }; return; }

            // FZ本体のドラッグ
            if (wPt.x >= fz.x && wPt.x <= fz.x + fz.width && wPt.y >= fz.y && wPt.y <= fz.y + fz.height) {
                // Delete: Option / Alt click
                if (e.altKey) {
                    onUpdateForbiddenZones(forbiddenZones.filter(z => z.id !== fz.id));
                    return;
                }

                dragRef.current = { handle: "fz_move", uuid: fz.id, startMouseX: mx, startMouseY: my, startRect: { ...fz } };
                setSelected(null);
                return;
            }
        }

        // 放流ポイント（SpawnPoints）のドラッグ/削除判定
        for (let i = spawnPoints.length - 1; i >= 0; i--) {
            const sp = spawnPoints[i];
            const RW_SP = (HANDLE_R * 1.5) / z;
            if (Math.abs(wPt.x - sp.x) <= RW_SP && Math.abs(wPt.y - sp.y) <= RW_SP) {
                if (e.altKey) {
                    onUpdateSpawnPoints(spawnPoints.filter(p => p.id !== sp.id));
                    return;
                }
                dragRef.current = { handle: `sp_move` as HandleType, uuid: sp.id, startMouseX: mx, startMouseY: my, startRect: { ...sp, width: 0, height: 0, scale: 1 } };
                setSelected(null);
                return;
            }
        }

        if (selected) {
            const t = displaysRef.current.find(d => d.uuid === selected);
            if (t && t.viewport) {
                const pts = getHandles(t.viewport);
                const z = camRef.current.zoom;
                const RW = HANDLE_R / z + 2;
                let hitHandle: HandleType | null = null;

                for (const [k, v] of Object.entries(pts as any)) {
                    if (k === "move") continue;
                    if (Math.abs(wPt.x - (v as any).x) <= RW && Math.abs(wPt.y - (v as any).y) <= RW) { hitHandle = k as HandleType; break; }
                }
                if (!hitHandle) {
                    const vp = t.viewport;
                    if (wPt.x >= vp.x && wPt.x <= vp.x + vp.width && wPt.y >= vp.y && wPt.y <= vp.y + vp.height) { hitHandle = "move"; }
                }

                if (hitHandle) {
                    undoStackRef.current.push(snapshotViewports());
                    redoStackRef.current.length = 0;
                    dragRef.current = {
                        handle: hitHandle, uuid: selected, startMouseX: mx, startMouseY: my,
                        startRect: { ...t.viewport! }
                    };
                    return;
                }
            }
        }

        let hitBody: string | null = null;
        for (const d of displaysRef.current) {
            const vp = d.viewport;
            if (!vp) continue;
            if (wPt.x >= vp.x && wPt.x <= vp.x + vp.width && wPt.y >= vp.y && wPt.y <= vp.y + vp.height) {
                hitBody = d.uuid;
                break; // 手前優先なら逆順で探すべきだけど、現状は単配列ループ
            }
        }

        if (hitBody !== selected) setSelected(hitBody);

        if (hitBody) {
            const t = displaysRef.current.find(d => d.uuid === hitBody)!;
            undoStackRef.current.push(snapshotViewports());
            redoStackRef.current.length = 0;
            dragRef.current = {
                handle: "move", uuid: hitBody, startMouseX: mx, startMouseY: my,
                startRect: { ...t.viewport! }
            };
        } else {
            setSelected(null);
        }
    }, [selected, displaysRef, getCanvasPt, canvasToWorld, snapshotViewports, setSelected, undoStackRef, redoStackRef, forbiddenZones, onUpdateForbiddenZones, spawnPoints, onUpdateSpawnPoints, worldW, worldH]);

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const { mx, my } = getCanvasPt(e.clientX, e.clientY);

        // パン
        if (isPanningRef.current) {
            const dx = mx - panStartRef.current.mx;
            const dy = my - panStartRef.current.my;
            camRef.current.panX = panStartRef.current.px + dx;
            camRef.current.panY = panStartRef.current.py + dy;
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(draw);
            return;
        }

        // ドラッグ中ではない（ホバー・レーザーポインター送信）
        if (!dragRef.current) {
            const wp2 = canvasToWorld(mx, my);
            let hitH: string | null = null;
            for (const d of displaysRef.current) {
                const vp = d.viewport;
                if (!vp) continue;
                if (wp2.x >= vp.x && wp2.x <= vp.x + vp.width && wp2.y >= vp.y && wp2.y <= vp.y + vp.height) { hitH = d.uuid; break; }
            }
            if (hitH !== hoveredRef.current) { hoveredRef.current = hitH; setHoveredUI(hitH); if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(draw); }

            const now = Date.now();
            if (now - pointerThrottleRef.current > sendRateSetting) {
                pointerThrottleRef.current = now;
                ws.send({ event: "pointer_move", x: wp2.x, y: wp2.y });
            }
            return;
        }

        // --- ここからワールド / フレームドラッグ・リサイズ ---
        const drag = dragRef.current;
        const z = camRef.current.zoom;
        const dx = (mx - drag.startMouseX) / z;
        const dy = (my - drag.startMouseY) / z;

        if (drag.handle === "world_br") {
            const wPt = canvasToWorld(mx, my);
            let nw = Math.max(1000, wPt.x);
            let nh = Math.max(400, wPt.y);
            pendingWorldSizeRef.current = { w: nw, h: nh };
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(draw);
            return;
        }

        if (drag.handle.startsWith("sp_")) {
            const target = spawnPoints.find(p => p.id === drag.uuid);
            if (!target) return;
            const nx = drag.startRect.x + dx;
            const ny = drag.startRect.y + dy;
            onUpdateSpawnPoints(spawnPoints.map(p => p.id === target.id ? { ...p, x: nx, y: ny } : p));
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(draw);
            return;
        }

        if (drag.handle.startsWith("fz_")) {
            // ForbiddenZoneの操作
            const target = forbiddenZones.find(z => z.id === drag.uuid);
            if (!target) return;

            let nx = drag.startRect.x, ny = drag.startRect.y, nw = drag.startRect.width, nh = drag.startRect.height;
            const h = drag.handle.replace("fz_", "");

            if (h === "move") {
                nx += dx; ny += dy;
            } else {
                if (h.includes("l")) { nx += dx; nw -= dx; }
                if (h.includes("r")) { nw += dx; }
                if (h.includes("t")) { ny += dy; nh -= dy; }
                if (h.includes("b")) { nh += dy; }
            }
            // Ensure minimum size and normalize negative dimensions
            if (nw < 5) { if (h.includes("l")) nx += (nw - 5); nw = 5; }
            if (nh < 5) { if (h.includes("t")) ny += (nh - 5); nh = 5; }

            onUpdateForbiddenZones(forbiddenZones.map(z => z.id === target.id ? { ...z, x: nx, y: ny, width: nw, height: nh } : z));
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(draw);
            return;
        }

        const dObj = displaysRef.current.find(d => d.uuid === drag.uuid);
        if (!dObj || !dObj.viewport) return;
        const vp = dObj.viewport;

        // ... （ドラッグロジック: startRect をもとに dx/dy を加算・減算する処理）...
        // 今回は既存のコードそのまま移植
        let nx = drag.startRect.x, ny = drag.startRect.y, nw = drag.startRect.width, nh = drag.startRect.height;

        if (drag.handle === "move") {
            nx += dx; ny += dy;
        } else {
            if (drag.handle.includes("l")) { nx += dx; nw -= dx; }
            if (drag.handle.includes("r")) { nw += dx; }
            if (drag.handle.includes("t")) { ny += dy; nh -= dy; }
            if (drag.handle.includes("b")) { nh += dy; }
            if (arLocked) {
                const AR = drag.startRect.width / drag.startRect.height;
                if (drag.handle.includes("r") || drag.handle.includes("l")) nh = nw / AR;
                else if (drag.handle.includes("t") || drag.handle.includes("b")) nw = nh * AR;
            }
        }
        if (nw < 100) { if (drag.handle.includes("l")) nx -= (100 - nw); nw = 100; }
        if (nh < 100) { if (drag.handle.includes("t")) ny -= (100 - nh); nh = 100; }

        // スナップロジック
        const SNAP = 8 / z;
        const vPts = { l: nx, r: nx + nw, cX: nx + nw / 2, t: ny, b: ny + nh, cY: ny + nh / 2 };
        let snapObjX: number | undefined, snapObjY: number | undefined;

        for (const other of displaysRef.current) {
            if (other.uuid === drag.uuid || !other.viewport) continue;
            const ovp = other.viewport;
            const oPts = { l: ovp.x, r: ovp.x + ovp.width, cX: ovp.x + ovp.width / 2, t: ovp.y, b: ovp.y + ovp.height, cY: ovp.y + ovp.height / 2 };

            if (!snapObjX) {
                if (Math.abs(vPts.l - oPts.r) < SNAP) { nx = oPts.r; snapObjX = oPts.r; }
                else if (Math.abs(vPts.r - oPts.l) < SNAP) { snapObjX = oPts.l; if (drag.handle === "move") nx = oPts.l - nw; else nw = oPts.l - nx; }
                else if (Math.abs(vPts.l - oPts.l) < SNAP) { nx = oPts.l; snapObjX = oPts.l; }
                else if (Math.abs(vPts.r - oPts.r) < SNAP) { snapObjX = oPts.r; if (drag.handle === "move") nx = oPts.r - nw; else nw = oPts.r - nx; }
                else if (Math.abs(vPts.cX - oPts.cX) < SNAP) { snapObjX = oPts.cX; if (drag.handle === "move") nx = oPts.cX - nw / 2; }
            }
            if (!snapObjY) {
                if (Math.abs(vPts.t - oPts.b) < SNAP) { ny = oPts.b; snapObjY = oPts.b; }
                else if (Math.abs(vPts.b - oPts.t) < SNAP) { snapObjY = oPts.t; if (drag.handle === "move") ny = oPts.t - nh; else nh = oPts.t - ny; }
                else if (Math.abs(vPts.t - oPts.t) < SNAP) { ny = oPts.t; snapObjY = oPts.t; }
                else if (Math.abs(vPts.b - oPts.b) < SNAP) { snapObjY = oPts.b; if (drag.handle === "move") ny = oPts.b - nh; else nh = oPts.b - ny; }
                else if (Math.abs(vPts.cY - oPts.cY) < SNAP) { snapObjY = oPts.cY; if (drag.handle === "move") ny = oPts.cY - nh / 2; }
            }
        }
        // World境界スナップ
        const currentWorldW = pendingWorldSizeRef.current?.w ?? worldW;
        const currentWorldH = pendingWorldSizeRef.current?.h ?? worldH;
        if (!snapObjX) {
            if (Math.abs(nx) < SNAP) { nx = 0; snapObjX = 0; }
            if (Math.abs(nx + nw - currentWorldW) < SNAP) { snapObjX = currentWorldW; if (drag.handle === "move") nx = currentWorldW - nw; else nw = currentWorldW - nx; }
        }
        if (!snapObjY) {
            if (Math.abs(ny) < SNAP) { ny = 0; snapObjY = 0; }
            if (Math.abs(ny + nh - currentWorldH) < SNAP) { snapObjY = currentWorldH; if (drag.handle === "move") ny = currentWorldH - nh; else nh = currentWorldH - ny; }
        }
        snapGuides.current = { x: snapObjX, y: snapObjY };

        vp.x = nx; vp.y = ny; vp.width = nw; vp.height = nh;

        // Scaleの再計算（横幅から逆算・表示機器の情報は変わらない前提）
        vp.scale = vp.width / (drag.startRect.width / (drag.startRect.scale || 1));

        // リストへの差分適用
        pendingViewports.current.set(drag.uuid, { ...vp });

        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(draw);

        const now = Date.now();
        if (now - previewThrottleRef.current > sendRateSetting) {
            previewThrottleRef.current = now;
            ws.send({ event: "viewport_preview", displayUuid: drag.uuid, viewport: vp });
        }
    }, [getCanvasPt, canvasToWorld, displaysRef, worldW, worldH, arLocked, sendRateSetting, draw, forbiddenZones, onUpdateForbiddenZones, spawnPoints, onUpdateSpawnPoints, pendingWorldSizeRef]);

    const handleMouseUp = useCallback(() => {
        isPanningRef.current = false;
        canvasRef.current!.style.cursor = "default";
        snapGuides.current = {};

        if (dragRef.current) {
            if (dragRef.current.handle === "world_br") {
                if (pendingWorldSizeRef.current) {
                    setWorldSize(Math.round(pendingWorldSizeRef.current.w), Math.round(pendingWorldSizeRef.current.h));
                }
                pendingWorldSizeRef.current = null;
            } else if (dragRef.current.handle.startsWith("fz_") || dragRef.current.handle.startsWith("sp_")) {
                // Already updated via state continuously
                // Normalize forbidden zones after drag ends
                if (dragRef.current.handle.startsWith("fz_")) {
                    onUpdateForbiddenZones(forbiddenZones.map(z => {
                        if (z.id === dragRef.current?.uuid) {
                            return {
                                ...z,
                                x: Math.round(z.width < 0 ? z.x + z.width : z.x),
                                y: Math.round(z.height < 0 ? z.y + z.height : z.y),
                                width: Math.round(Math.abs(z.width)),
                                height: Math.round(Math.abs(z.height))
                            };
                        }
                        return z;
                    }).filter(z => z.width >= 5 && z.height >= 5)); // Filter out too small zones
                }
            } else {
                const dObj = displaysRef.current.find(d => d.uuid === dragRef.current!.uuid);
                if (dObj && dObj.viewport) {
                    onSaveViewport(dObj.uuid, dObj.viewport).then(() => {
                        pendingViewports.current.delete(dObj.uuid);
                    });
                }
            }
            dragRef.current = null;
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(draw);
        }
    }, [displaysRef, onSaveViewport, draw, onUpdateForbiddenZones]);

    const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) { // ピンチ・ズーム
            const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
            const rect = canvasRef.current!.getBoundingClientRect();
            const mx = e.clientX - rect.left, my = e.clientY - rect.top;
            const wPtStr = canvasToWorld(mx, my);
            camRef.current.zoom *= zoomDelta;
            camRef.current.panX = mx - wPtStr.x * camRef.current.zoom;
            camRef.current.panY = my - wPtStr.y * camRef.current.zoom;
        } else { // パン
            camRef.current.panX -= e.deltaX;
            camRef.current.panY -= e.deltaY;
        }
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(draw);
    }, [canvasToWorld, draw]);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.code === "Space") { spaceRef.current = true; if (canvasRef.current) canvasRef.current.style.cursor = "grab"; e.preventDefault(); return; }

        // 矢印キーでの1px微調整機能
        if (selected && (e.code === "ArrowUp" || e.code === "ArrowDown" || e.code === "ArrowLeft" || e.code === "ArrowRight")) {
            e.preventDefault();
            const dObj = displaysRef.current.find(d => d.uuid === selected);
            if (!dObj || !dObj.viewport) return;
            const vp = { ...dObj.viewport };
            const speed = e.shiftKey ? 10 : 1; // Shift押下時は10px
            if (e.code === "ArrowUp") vp.y -= speed;
            if (e.code === "ArrowDown") vp.y += speed;
            if (e.code === "ArrowLeft") vp.x -= speed;
            if (e.code === "ArrowRight") vp.x += speed;

            undoStackRef.current.push(snapshotViewports());
            redoStackRef.current.length = 0;

            // update state directly and save
            dObj.viewport = vp;
            onSaveViewport(selected, vp);
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(draw);
        }
    }, [selected, displaysRef, snapshotViewports, onSaveViewport, draw]);
    const handleKeyUp = useCallback((e: KeyboardEvent) => {
        if (e.code === "Space") { spaceRef.current = false; if (canvasRef.current && !isPanningRef.current) canvasRef.current.style.cursor = "default"; }
    }, []);

    useEffect(() => {
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        return () => { window.removeEventListener("keydown", handleKeyDown); window.removeEventListener("keyup", handleKeyUp); };
    }, [handleKeyDown, handleKeyUp]);

    return (
        <div className="flex-1 relative cursor-crosshair overflow-hidden touch-none" ref={wrapperRef} onWheel={handleWheel}>
            <canvas
                ref={canvasRef}
                onPointerDown={handleMouseDown}
                onPointerMove={handleMouseMove}
                onPointerUp={handleMouseUp}
                onPointerLeave={handleMouseUp}
                onContextMenu={e => e.preventDefault()}
                style={{ width: "100%", height: "100%", display: "block" }}
            />
        </div>
    );
}
