import React from "react";
import ReactDOM from "react-dom/client";
import { createWsClient } from "../shared/useWs";
import type { WsClientMessage } from "@aquarium/shared";
import type { PendingFish } from "@aquarium/shared";
import { Editor } from "../controller/Editor";
import { api } from "../shared/api";
import "../styles/global.css";

// ============================================================
// guest: スマホ餌やりUI（1ファイルで完結）
// ============================================================
const ws = createWsClient("guest");

function App(): React.ReactElement {
    const [connected, setConnected] = React.useState(false);
    const [feedCount, setFeedCount] = React.useState(0);
    const [ripple, setRipple] = React.useState<{ x: number; y: number; id: number } | null>(null);
    const [mode, setMode] = React.useState<"feed" | "create">("feed");
    const [editingFish, setEditingFish] = React.useState<PendingFish | null>(null);

    const uploadPhoto = async (file: File): Promise<void> => {
        const form = new FormData();
        form.append("image", file);
        const res = await api.request("/api/scan", { method: "POST", body: form });
        if (!res.ok) return;
        const data = await res.json() as { fish: PendingFish };
        setEditingFish(data.fish);
    };

    React.useEffect(() => {
        const remove = ws.onMessage((msg) => {
            if (msg.event === "reload") location.reload();
        });
        // 接続状態を定期確認
        const t = setInterval(() => setConnected(ws.connected), 500);
        return () => { remove(); clearInterval(t); };
    }, []);

    const handleTap = (e: React.MouseEvent | React.TouchEvent): void => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const clientX = "touches" in e ? e.touches[0]?.clientX ?? 0 : (e as React.MouseEvent).clientX;
        const clientY = "touches" in e ? e.touches[0]?.clientY ?? 0 : (e as React.MouseEvent).clientY;

        // タップ位置をグローバル座標に変換（world幅 3840 基準）
        const globalX = Math.round((clientX / rect.width) * 3840);
        const globalY = Math.round((clientY / rect.height) * 1080);

        ws.send({ event: "spawn_food", x: globalX, y: globalY } satisfies WsClientMessage);
        setFeedCount((n) => n + 1);
        setRipple({ x: clientX, y: clientY, id: Date.now() });
        setTimeout(() => setRipple(null), 700);
    };

    if (editingFish) {
        return <Editor fish={editingFish} onReleased={() => { setEditingFish(null); setMode("feed"); }}
            onCancel={() => setEditingFish(null)} />;
    }

    if (mode === "create") {
        return (
            <div style={{ minHeight: "100svh", background: "linear-gradient(180deg,#001a3a,#000d24)", color: "white", padding: 24, textAlign: "center" }}>
                <button className="btn btn--ghost" onClick={() => setMode("feed")}>← エサやりへ</button>
                <h1 style={{ margin: "48px 0 12px" }}>魚を放流する</h1>
                <p style={{ color: "#7ec8e3", marginBottom: 24 }}>写真を撮るかPNGを選ぶと、泳ぎ方・向き・大きさ・速度を設定できます。</p>
                <label className="btn btn--primary" style={{ display: "inline-block", padding: "16px 24px" }}>
                    写真を撮る / PNGを選ぶ
                    <input type="file" accept="image/*" capture="environment" hidden
                        onChange={e => e.target.files?.[0] && void uploadPhoto(e.target.files[0])} />
                </label>
            </div>
        );
    }

    return (
        <div
            style={{
                minHeight: "100svh", position: "relative", userSelect: "none", touchAction: "none",
                background: "linear-gradient(180deg,#001a3a 0%,#000d24 100%)",
                color: "white", fontFamily: "'Hiragino Sans','Noto Sans JP',sans-serif",
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", gap: 24,
            }}
            onClick={handleTap}
            onTouchStart={handleTap}
        >
            {/* リップルエフェクト */}
            {ripple && (
                <div key={ripple.id} style={{
                    position: "fixed", left: ripple.x, top: ripple.y, width: 60, height: 60,
                    marginLeft: -30, marginTop: -30, borderRadius: "50%",
                    border: "3px solid #7ec8e3", pointerEvents: "none",
                    animation: "rippleOut 0.6s ease-out forwards",
                }} />
            )}
            <style>{`
        @keyframes rippleOut {
          from { transform: scale(0); opacity: 1; }
          to   { transform: scale(3); opacity: 0; }
        }
      `}</style>

            <div style={{ textAlign: "center", pointerEvents: "none" }}>
                <div style={{ fontSize: "4rem", marginBottom: 8 }}>🐠</div>
                <h1 style={{ fontSize: "1.5rem", marginBottom: 4 }}>エサやり</h1>
                <p style={{ color: "#7ec8e3", fontSize: "0.95rem", marginBottom: 32 }}>
                    画面をタップしてエサを投げよう！
                </p>
                <div style={{
                    background: connected ? "rgba(0,200,100,0.2)" : "rgba(200,50,50,0.2)",
                    border: `1px solid ${connected ? "#00c864" : "#c83200"}`,
                    borderRadius: 999, padding: "6px 16px", display: "inline-block", marginBottom: 16,
                }}>
                    {connected ? "🟢 接続中" : "🔴 接続中断"}
                </div>
                {feedCount > 0 && (
                    <p style={{ color: "#ffd700", fontSize: "0.9rem" }}>🍖 エサ投入 {feedCount}回</p>
                )}
                <button className="btn btn--primary" style={{ marginTop: 28, pointerEvents: "auto" }}
                    onClick={e => { e.stopPropagation(); setMode("create"); }}>
                    自分の魚を放流する
                </button>
            </div>
        </div>
    );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode><App /></React.StrictMode>
);
