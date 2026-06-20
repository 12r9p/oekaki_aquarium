import React from "react";
import ReactDOM from "react-dom/client";
import { createWsClient } from "../shared/useWs";
import type { WsClientMessage } from "@aquarium/shared";
import type { PendingFish } from "@aquarium/shared";
import { Editor } from "../controller/Editor";
import { api } from "../shared/api";
import "../styles/global.css";
import { Button } from "@/components/ui/button";
import { Camera, Fish, Wifi, WifiOff } from "lucide-react";

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
    const fileInputRef = React.useRef<HTMLInputElement>(null);

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

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
        if ((e.target as HTMLElement).closest("button")) {
            return;
        }

        const rect = e.currentTarget.getBoundingClientRect();
        const clientX = e.clientX;
        const clientY = e.clientY;

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
            <div className="flex min-h-screen items-center justify-center bg-slate-50 p-5 text-slate-900">
                <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
                <Button variant="ghost" onClick={() => setMode("feed")} className="mb-6">エサやりへ戻る</Button>
                <h1 className="text-xl font-bold">魚を放流する</h1>
                <p className="mt-2 text-sm leading-6 text-slate-500">写真を撮るか PNG を選ぶと、泳ぎ方・向き・大きさ・速度を設定できます。</p>
                <Button className="mt-6 w-full gap-2" onClick={() => fileInputRef.current?.click()}>
                    <Camera className="h-4 w-4" />写真を撮る / PNGを選ぶ
                </Button>
                <input type="file" ref={fileInputRef} accept="image/*" capture="environment" className="hidden"
                    onChange={e => e.target.files?.[0] && void uploadPhoto(e.target.files[0])} />
                </div>
            </div>
        );
    }

    return (
        <div
            className="flex min-h-screen select-none flex-col items-center justify-center gap-6 bg-slate-950 p-6 text-white"
            style={{
                touchAction: "none",
            }}
            onPointerDown={handlePointerDown}
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

            <div className="pointer-events-none text-center">
                <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full border border-sky-400/30 bg-sky-400/10">
                    <Fish className="h-10 w-10 text-sky-200" />
                </div>
                <h1 className="text-2xl font-bold">エサやり</h1>
                <p className="mt-2 text-sm text-sky-100/80">
                    画面をタップしてエサを投げよう！
                </p>
                <div className={`mx-auto mt-8 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold ${connected ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100" : "border-red-400/40 bg-red-400/10 text-red-100"}`}>
                    {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                    {connected ? "接続中" : "接続中断"}
                </div>
                {feedCount > 0 && (
                    <p className="mt-3 text-sm font-bold text-amber-200">エサ投入 {feedCount}回</p>
                )}
                <Button className="pointer-events-auto mt-8"
                    onClick={e => { e.stopPropagation(); setMode("create"); }}>
                    自分の魚を放流する
                </Button>
            </div>
        </div>
    );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode><App /></React.StrictMode>
);
