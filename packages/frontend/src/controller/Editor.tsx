import { useState, useRef, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { FishConfig, PendingFish, FishType, Vector2 } from "@aquarium/shared";
import { api } from "../shared/api";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ArrowLeft, Download, Waves, X } from "lucide-react";

interface EditorProps {
    fish: PendingFish;
    onReleased: () => void;
    onCancel: () => void;
}

export function Editor({ fish, onReleased, onCancel }: EditorProps): React.ReactElement {
    const [fishType, setFishType] = useState<FishType>(fish.fishMeta?.type === "custom" ? "school" : fish.fishMeta?.type ?? "school");
    const [scale, setScale] = useState(fish.fishMeta?.scale ?? 1.0);
    const [speed, setSpeed] = useState(fish.fishMeta?.speed ?? 1.0);
    const [rotationDeg, setRotationDeg] = useState(0);
    const [direction, setDirection] = useState<"auto" | "left" | "right">(fish.fishMeta?.direction ?? "auto");
    const [isRecording, setIsRecording] = useState(false);
    const [motionPath, setMotionPath] = useState<Vector2[]>([]);
    const [releasedImageUrl, setReleasedImageUrl] = useState<string | null>(null);
    const [releasing, setReleasing] = useState(false);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const stopRecording = useCallback((): void => {
        setIsRecording(false);
        setMotionPath((prev) => smoothPath(prev));
    }, []);

    const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>): void => {
        if (!isRecording) return;
        const rect = e.currentTarget.getBoundingClientRect();
        setMotionPath((prev) => [
            ...prev,
            { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 },
        ]);
        const ctx = canvasRef.current?.getContext("2d");
        ctx?.fillStyle && void 0;
        if (ctx) {
            ctx.fillStyle = "#7ec8e3";
            ctx.beginPath();
            ctx.arc(e.clientX - rect.left, e.clientY - rect.top, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }, [isRecording]);

    const handleRelease = async (): Promise<void> => {
        setReleasing(true);
        try {
            const config: FishConfig = {
                id: fish.id,
                type: fishType,
                textureUrl: fish.imageUrl,
                userParams: { scale, speed, rotationOffset: (rotationDeg * Math.PI) / 180, direction },
                motionPath: motionPath.length > 1 ? motionPath : undefined,
            };
            const res = await api.request("/api/release", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(config),
            });
            if (!res.ok) throw new Error("放流失敗");
            const owned = JSON.parse(localStorage.getItem("aquarium-owned-fish") ?? "[]") as string[];
            if (!owned.includes(fish.id)) {
                localStorage.setItem("aquarium-owned-fish", JSON.stringify([...owned, fish.id]));
            }
            setReleasedImageUrl(fish.imageUrl);
        } catch {
            alert("放流に失敗しました。もう一度試してください。");
        } finally {
            setReleasing(false);
        }
    };

    const handleDownload = async (): Promise<void> => {
        const res = await api.request("/api/png/configure", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                imageUrl: fish.imageUrl,
                meta: {
                    version: 1, author: fish.fishMeta?.author ?? "anonymous", type: fishType,
                    scale, speed, direction, pinnedLayerId: null, tags: fish.fishMeta?.tags ?? [],
                },
            }),
        });
        if (!res.ok) { alert("PNGの作成に失敗しました"); return; }
        const link = document.createElement("a");
        link.href = URL.createObjectURL(await res.blob());
        link.download = `${fish.id}.png`;
        link.click();
        URL.revokeObjectURL(link.href);
    };

    if (releasedImageUrl) {
        const qrUrl = `${location.origin}/guest`;
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50 p-5 text-slate-900">
                <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
                <h2 className="text-xl font-bold">泳ぎ出しました</h2>
                <p className="mt-2 text-sm text-slate-500">エサをあげる場合は QR コードを読み取ってください。</p>
                <div className="mx-auto my-6 flex w-fit rounded-lg border border-slate-200 bg-white p-3">
                    <QRCodeSVG value={qrUrl} size={200} bgColor="#fff" fgColor="#001a3a" />
                </div>
                <Button onClick={onReleased} className="w-full">待合室に戻る</Button>
                </div>
            </div>
        );
    }

    const typeLabels: Record<FishType, string> = {
        tuna: "🐟 マグロ - 高速直線往復",
        school: "🐠🐠 イワシ - 群れで回遊",
        squid: "🦑 イカ - ふわふわパルス",
        jellyfish: "🪼 クラゲ - 上下浮遊",
        shark: "🦈 サメ - 大弧単独回遊",
        anchor: "🌿 固定 - 床に固定",
        custom: "カスタム",
    };
    // コントローラーで表示するプリセット順（旧型は末尾に）
    const presetOrder: FishType[] = ["tuna", "school", "squid", "jellyfish", "shark", "anchor"];

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900">
            <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
                <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
                    <Button variant="ghost" size="sm" onClick={onCancel} className="gap-1.5"><ArrowLeft className="h-4 w-4" />戻る</Button>
                    <h2 className="text-base font-bold">魚を設定する</h2>
                    <Button variant="ghost" size="sm" onClick={onCancel} className="h-9 w-9 p-0"><X className="h-4 w-4" /></Button>
                </div>
            </header>

            <main className="mx-auto grid max-w-5xl gap-5 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="flex min-h-[280px] items-center justify-center rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <img
                    src={fish.imageUrl}
                    alt="fish"
                    className="max-h-[360px] max-w-full object-contain"
                    style={{ transform: `rotate(${rotationDeg}deg)` }}
                />
            </div>

            <div className="flex flex-col gap-4">
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <label className="text-xs font-bold uppercase text-slate-500">泳ぐ向き</label>
                <div className="mt-3 grid grid-cols-3 gap-2">
                    {([["auto", "自動"], ["left", "← 左向き"], ["right", "右向き →"]] as const).map(([value, label]) => (
                        <Button key={value} variant={direction === value ? "default" : "outline"} size="sm"
                            onClick={() => setDirection(value)}>{label}</Button>
                    ))}
                </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between"><label className="text-xs font-bold uppercase text-slate-500">回転補正</label><span className="font-mono text-sm font-bold text-slate-700">{rotationDeg}°</span></div>
                <Slider value={[rotationDeg]} min={-180} max={180} step={1} onValueChange={value => setRotationDeg(value[0] ?? 0)} />
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <label className="text-xs font-bold uppercase text-slate-500">動きのタイプ</label>
                <div className="mt-3 grid grid-cols-2 gap-2">
                    {presetOrder.map((t) => (
                        <Button key={t} variant={fishType === t ? "default" : "outline"} size="sm" className="h-auto justify-start whitespace-normal py-2 text-left"
                            onClick={() => setFishType(t)}>
                            {typeLabels[t]}
                        </Button>
                    ))}
                </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between"><label className="text-xs font-bold uppercase text-slate-500">大きさ</label><span className="font-mono text-sm font-bold text-slate-700">×{scale.toFixed(1)}</span></div>
                <Slider value={[scale]} min={0.3} max={3.0} step={0.1} onValueChange={value => setScale(value[0] ?? 1)} />
                <div className="mb-3 mt-5 flex items-center justify-between"><label className="text-xs font-bold uppercase text-slate-500">速さ</label><span className="font-mono text-sm font-bold text-slate-700">×{speed.toFixed(1)}</span></div>
                <Slider value={[speed]} min={0.2} max={3.0} step={0.1} onValueChange={value => setSpeed(value[0] ?? 1)} />
            </section>

            {fishType === "anchor" && (
                <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                    <label className="text-xs font-bold uppercase text-slate-500">動きを手書きで録画</label>
                    <div className="relative mt-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                        <canvas ref={canvasRef} width={280} height={200} className="block h-[200px] w-full touch-none"
                            onPointerDown={() => { setMotionPath([]); setIsRecording(true); }}
                            onPointerMove={handlePointerMove}
                            onPointerUp={stopRecording} onPointerLeave={stopRecording} />
                        {isRecording && <div className="absolute right-2 top-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">録画中</div>}
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                        <span className="font-mono text-xs text-slate-500">{motionPath.length}点</span>
                        <Button variant="outline" size="sm" onClick={() => {
                            setMotionPath([]);
                            canvasRef.current?.getContext("2d")?.clearRect(0, 0, 280, 200);
                        }}>クリア</Button>
                    </div>
                </section>
            )}

            <div className="sticky bottom-0 flex gap-2 border-t border-slate-200 bg-white/95 p-3 backdrop-blur lg:static lg:rounded-lg lg:border lg:shadow-sm">
                <Button variant="outline" onClick={() => void handleDownload()} className="flex-1 gap-1.5"><Download className="h-4 w-4" />PNG</Button>
                <Button onClick={() => void handleRelease()} disabled={releasing} className="flex-[2] gap-1.5">
                    <Waves className="h-4 w-4" />{releasing ? "放流中..." : "泳がせる"}
                </Button>
            </div>
            </div>
            </main>
        </div>
    );
}

function smoothPath(path: Vector2[]): Vector2[] {
    if (path.length < 5) return path;
    return path.map((_, i, arr) => {
        const slice = arr.slice(Math.max(0, i - 2), Math.min(arr.length, i + 3));
        return {
            x: slice.reduce((s, p) => s + p.x, 0) / slice.length,
            y: slice.reduce((s, p) => s + p.y, 0) / slice.length,
        };
    });
}
