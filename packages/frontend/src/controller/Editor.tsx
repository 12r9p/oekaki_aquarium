import { useState, useRef, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { FishConfig, PendingFish, FishType, Vector2 } from "@aquarium/shared";
import { api } from "../shared/api";
import { generateUuid } from "../shared/uuid";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ArrowLeft, Download, ImagePlus, Waves } from "lucide-react";
import "./Editor.css";

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
    const [author, setAuthor] = useState(fish.fishMeta?.author && fish.fishMeta.author !== "anonymous" ? fish.fishMeta.author : localStorage.getItem("aquarium-sender-name") ?? "");
    const [logoData, setLogoData] = useState<string | null>(localStorage.getItem("aquarium-default-logo"));
    const [logoScale, setLogoScale] = useState(fish.fishMeta?.logoScale ?? 22);
    const [logoX, setLogoX] = useState(fish.fishMeta?.logoX ?? 4);
    const [logoY, setLogoY] = useState(fish.fishMeta?.logoY ?? 4);
    const [isRecording, setIsRecording] = useState(false);
    const [motionPath, setMotionPath] = useState<Vector2[]>([]);
    const [releasedImageUrl, setReleasedImageUrl] = useState<string | null>(null);
    const [releasing, setReleasing] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const artworkCanvasRef = useRef<HTMLCanvasElement>(null);
    const logoInputRef = useRef<HTMLInputElement>(null);

    const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("画像を読み込めませんでした。"));
        image.src = src;
    });

    const makeArtwork = async (): Promise<Blob> => {
        const image = await loadImage(fish.imageUrl);
        const canvas = artworkCanvasRef.current ?? document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("この端末では画像を合成できません。");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0);
        if (logoData) {
            const logo = await loadImage(logoData);
            const width = canvas.width * logoScale / 100;
            ctx.drawImage(logo, canvas.width * logoX / 100, canvas.height * logoY / 100, width, width * logo.naturalHeight / logo.naturalWidth);
        }
        return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNGを作成できませんでした。")), "image/png"));
    };

    const getMeta = () => ({
        version: 2, author: author.trim() || "anonymous", senderId: getSenderId(), type: fishType,
        scale, speed, direction, pinnedLayerId: null, tags: fish.fishMeta?.tags ?? [],
        logoScale: logoData ? logoScale : undefined, logoX: logoData ? logoX : undefined, logoY: logoData ? logoY : undefined,
    });

    const onLogoSelected = async (file?: File): Promise<void> => {
        if (!file) return;
        if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) { setErrorMessage("8MB以下の画像をロゴに選んでください。"); return; }
        try {
            const objectUrl = URL.createObjectURL(file);
            const image = await loadImage(objectUrl);
            URL.revokeObjectURL(objectUrl);
            const ratio = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
            canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
            const data = canvas.toDataURL("image/png");
            setLogoData(data);
            localStorage.setItem("aquarium-default-logo", data);
            setErrorMessage(null);
        } catch { setErrorMessage("ロゴを読み込めませんでした。"); }
    };

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
        setErrorMessage(null);
        try {
            const meta = getMeta();
            const artwork = await makeArtwork();
            const form = new FormData();
            form.append("image", artwork, `${fish.id}.png`);
            form.append("meta", JSON.stringify(meta));
            const artworkRes = await api.request(`/api/pending/${encodeURIComponent(fish.id)}/artwork`, { method: "PUT", body: form });
            if (!artworkRes.ok) throw new Error("魚の画像を保存できませんでした。通信状態を確認してください。");
            const updated = await artworkRes.json() as { fish: PendingFish };
            const config: FishConfig = {
                id: fish.id,
                type: fishType,
                textureUrl: updated.fish.imageUrl,
                author: meta.author,
                fishMeta: meta,
                userParams: { scale, speed, rotationOffset: (rotationDeg * Math.PI) / 180, direction },
                motionPath: motionPath.length > 1 ? motionPath : undefined,
            };
            const res = await api.request("/api/release", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(config),
            });
            if (!res.ok) throw new Error("放流に失敗しました。設定を保ったまま、もう一度お試しください。");
            localStorage.setItem("aquarium-sender-name", meta.author === "anonymous" ? "" : meta.author);
            const owned = JSON.parse(localStorage.getItem("aquarium-owned-fish") ?? "[]") as string[];
            if (!owned.includes(fish.id)) {
                localStorage.setItem("aquarium-owned-fish", JSON.stringify([...owned, fish.id]));
            }
            setReleasedImageUrl(fish.imageUrl);
        } catch (cause) {
            setErrorMessage(cause instanceof Error ? cause.message : "放流に失敗しました。もう一度お試しください。");
        } finally {
            setReleasing(false);
        }
    };

    const handleDownload = async (): Promise<void> => {
        try {
            const blob = await makeArtwork();
            const imageData = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("PNGを読み込めませんでした。"));
                reader.onerror = () => reject(new Error("PNGを読み込めませんでした。"));
                reader.readAsDataURL(blob);
            });
            const res = await api.request("/api/png/configure", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ imageData, meta: getMeta() }),
            });
            if (!res.ok) throw new Error("PNGの作成に失敗しました。通信状態を確認してください。");
            const url = URL.createObjectURL(await res.blob());
            const link = document.createElement("a");
            link.href = url; link.download = `${fish.id}.png`; link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (cause) {
            setErrorMessage(cause instanceof Error ? cause.message : "PNGの作成に失敗しました。");
        }
    };

    if (releasedImageUrl) {
        const qrUrl = `${location.origin}/guest`;
        return (
            <div className="release-success">
                <div className="release-success-card">
                <span className="release-success-icon" aria-hidden="true">🐟</span>
                <p className="release-eyebrow">放流完了</p>
                <h2 className="text-xl font-bold">泳ぎ出しました</h2>
                <p className="mt-2 text-sm text-slate-500">QRコードを開くと、あなたの魚としてスマートフォンに登録できます。</p>
                <div className="mx-auto my-6 flex w-fit rounded-lg border border-slate-200 bg-white p-3">
                    <QRCodeSVG value={`${qrUrl}?fish=${encodeURIComponent(fish.id)}`} size={200} bgColor="#fff" fgColor="#103a43" />
                </div>
                <Button variant="outline" onClick={() => void handleDownload()} className="mb-2 w-full"><Download className="mr-2 h-4 w-4" />魚のPNGを持ち帰る</Button>
                <Button onClick={onReleased} className="w-full">待合室へ戻る</Button>
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
        <main className="release-editor">
            <header className="release-header">
                <Button variant="ghost" size="sm" onClick={onCancel} className="gap-1.5"><ArrowLeft className="h-4 w-4" />戻る</Button>
                <div><p className="release-eyebrow">お絵かき水族館</p><h1>魚を水槽へ送り出す</h1></div>
                <span className="release-step">設定中</span>
            </header>

            <div className="release-layout">
            <section className="release-preview-panel" aria-label="魚のプレビュー">
                <span className="release-watermark">PREVIEW · {fish.id.slice(0, 8)}</span>
                <div className="release-fish-stage"><div className="release-fish-art" style={{ transform: `rotate(${rotationDeg}deg)` }}>
                    <img src={fish.imageUrl} alt="放流する魚の絵" />
                    {logoData && <img className="release-logo" src={logoData} alt="ロゴの配置プレビュー" style={{ width: `${logoScale}%`, left: `${logoX}%`, top: `${logoY}%` }} />}
                </div></div>
                <div className="release-preview-caption"><span className="release-live-dot" />ロゴと魚の画像を端末で合成します</div>
                <canvas ref={artworkCanvasRef} className="release-hidden-canvas" aria-hidden="true" />
            </section>

            <div className="release-controls">
            <section className="release-card">
                <div className="release-card-heading"><span className="release-number">01</span><div><h2>魚の名前と送り主</h2><p>PNGに送信元IDを記録します</p></div></div>
                <label className="release-field">作者名 <span>任意</span><input value={author} onChange={event => setAuthor(event.target.value)} maxLength={40} placeholder="例：さくら" autoComplete="nickname" /></label>
                <div className="release-sender"><span className="release-sender-mark">ID</span><span><strong>この端末の送信元ID</strong><small>{getSenderId().slice(0, 18)}…</small></span><span className="release-private">端末内で作成</span></div>
            </section>

            <section className="release-card">
                <div className="release-card-heading"><span className="release-number">02</span><div><h2>ロゴを魚にのせる</h2><p>位置と大きさは魚ごとに保存</p></div></div>
                <input ref={logoInputRef} type="file" accept="image/*" className="sr-only" onChange={event => void onLogoSelected(event.target.files?.[0])} />
                <div className="release-logo-row"><div className="release-logo-thumb">{logoData ? <img src={logoData} alt="" /> : <ImagePlus aria-hidden="true" />}</div><div className="release-logo-copy"><strong>{logoData ? "ロゴを登録済み" : "ロゴ画像を追加"}</strong><span>透過PNGがおすすめです</span></div><Button type="button" variant="outline" size="sm" onClick={() => logoInputRef.current?.click()}>{logoData ? "変更" : "選ぶ"}</Button>{logoData && <Button type="button" variant="ghost" size="sm" onClick={() => { setLogoData(null); localStorage.removeItem("aquarium-default-logo"); }}>削除</Button>}</div>
                {logoData && <>
                    <RangeControl label="ロゴの大きさ" value={logoScale} suffix="%" min={8} max={42} step={1} onChange={setLogoScale} />
                    <RangeControl label="左から" value={logoX} suffix="%" min={0} max={42} step={1} onChange={setLogoX} />
                    <RangeControl label="上から" value={logoY} suffix="%" min={0} max={42} step={1} onChange={setLogoY} />
                </>}
            </section>

            <section className="release-card">
                <div className="release-card-heading"><span className="release-number">03</span><div><h2>泳ぎ方を決める</h2><p>大きさ ×{scale.toFixed(1)} · 速さ ×{speed.toFixed(1)}</p></div></div>
                <div className="release-presets">{presetOrder.map((t) => <button type="button" key={t} aria-pressed={fishType === t} className={`release-preset ${fishType === t ? "is-selected" : ""}`} onClick={() => setFishType(t)}>{typeLabels[t]}</button>)}</div>
                <div className="release-direction" role="group" aria-label="泳ぐ向き">{([["auto", "自動"], ["left", "← 左"], ["right", "右 →"]] as const).map(([value, label]) => <button type="button" key={value} className={direction === value ? "is-selected" : ""} aria-pressed={direction === value} onClick={() => setDirection(value)}>{label}</button>)}</div>
                <RangeControl label="大きさ" value={scale} suffix="×" min={0.3} max={3} step={0.1} onChange={setScale} />
                <RangeControl label="泳ぐ速さ" value={speed} suffix="×" min={0.2} max={3} step={0.1} onChange={setSpeed} />
                <RangeControl label="回転補正" value={rotationDeg} suffix="°" min={-180} max={180} step={1} onChange={setRotationDeg} />
            </section>

            {fishType === "anchor" && (
                <section className="release-card">
                    <div className="release-card-heading"><span className="release-number">04</span><div><h2>泳ぐ道を描く</h2><p>指で動きを記録します</p></div></div>
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

            {errorMessage && <p className="release-error" role="alert">{errorMessage}</p>}
            <div className="release-actions">
                <Button variant="outline" onClick={() => void handleDownload()} className="release-download"><Download className="h-4 w-4" />持ち帰りPNG</Button>
                <Button onClick={() => void handleRelease()} disabled={releasing} className="release-submit">
                    <Waves className="h-4 w-4" />{releasing ? "水槽へ送信中…" : "この魚を泳がせる"}
                </Button>
            </div>
            <p className="release-footnote">画像と設定は一緒に保存されます。放流後は「自分の魚」から見られます。</p>
            </div>
            </div>
        </main>
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

function getSenderId(): string {
    const stored = localStorage.getItem("aquarium-sender-id");
    if (stored) return stored;
    const id = generateUuid();
    localStorage.setItem("aquarium-sender-id", id);
    return id;
}

function RangeControl({ label, value, suffix, min, max, step, onChange }: { label: string; value: number; suffix: string; min: number; max: number; step: number; onChange: (value: number) => void }): React.ReactElement {
    const formatted = suffix === "×" ? `×${value.toFixed(1)}` : `${value}${suffix}`;
    return <div className="release-range"><div className="release-range-label"><label>{label}</label><output>{formatted}</output></div><Slider aria-label={label} value={[value]} min={min} max={max} step={step} onValueChange={values => onChange(values[0] ?? min)} /></div>;
}
