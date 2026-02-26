import { useState, useRef, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { FishConfig, PendingFish, FishType, Vector2 } from "@aquarium/shared";
import "./Editor.css";

interface EditorProps {
    fish: PendingFish;
    onReleased: () => void;
    onCancel: () => void;
}

export function Editor({ fish, onReleased, onCancel }: EditorProps): React.ReactElement {
    const [fishType, setFishType] = useState<FishType>("swimmer");
    const [scale, setScale] = useState(1.0);
    const [speed, setSpeed] = useState(1.0);
    const [rotationDeg, setRotationDeg] = useState(0);
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
                userParams: { scale, speed, rotationOffset: (rotationDeg * Math.PI) / 180 },
                motionPath: motionPath.length > 1 ? motionPath : undefined,
            };
            const res = await fetch("/api/release", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(config),
            });
            if (!res.ok) throw new Error("放流失敗");
            setReleasedImageUrl(fish.imageUrl);
        } catch {
            alert("放流に失敗しました。もう一度試してください。");
        } finally {
            setReleasing(false);
        }
    };

    if (releasedImageUrl) {
        const qrUrl = `${location.origin}/guest`;
        return (
            <div className="editor editor--released">
                <div className="released-splash">🎉</div>
                <h2>泳ぎ出したよ！</h2>
                <p className="released-desc">エサをあげるなら→QRコードを読み取ってね</p>
                <div className="qr-container">
                    <QRCodeSVG value={qrUrl} size={200} bgColor="#fff" fgColor="#001a3a" />
                </div>
                <button className="btn btn--primary" onClick={onReleased}>待合室に戻る</button>
            </div>
        );
    }

    const typeLabels: Record<FishType, string> = {
        swimmer: "🐟 自由に泳ぐ",
        looper: "🪼 手書きでループ",
        anchor: "🌿 床に固定",
    };

    return (
        <div className="editor">
            <header className="editor-header">
                <button className="btn btn--ghost" onClick={onCancel}>← 戻る</button>
                <h2>魚を設定する</h2>
            </header>

            <div className="editor-preview">
                <img
                    src={fish.imageUrl}
                    alt="fish"
                    className="editor-preview-image"
                    style={{ transform: `rotate(${rotationDeg}deg)` }}
                />
            </div>

            <section className="editor-section">
                <label className="editor-label">🔄 回転補正</label>
                <input type="range" min={-180} max={180} step={1} value={rotationDeg}
                    onChange={(e) => setRotationDeg(Number(e.target.value))} className="editor-slider" />
                <span className="editor-value">{rotationDeg}°</span>
            </section>

            <section className="editor-section">
                <label className="editor-label">🎭 動きのタイプ</label>
                <div className="editor-type-grid">
                    {(["swimmer", "looper", "anchor"] as FishType[]).map((t) => (
                        <button key={t} className={`editor-type-btn ${fishType === t ? "active" : ""}`}
                            onClick={() => setFishType(t)}>
                            {typeLabels[t]}
                        </button>
                    ))}
                </div>
            </section>

            <section className="editor-section">
                <label className="editor-label">📐 大きさ: {scale.toFixed(1)}</label>
                <input type="range" min={0.3} max={3.0} step={0.1} value={scale}
                    onChange={(e) => setScale(Number(e.target.value))} className="editor-slider" />
                <label className="editor-label" style={{ marginTop: 12 }}>⚡ 速さ: {speed.toFixed(1)}</label>
                <input type="range" min={0.2} max={3.0} step={0.1} value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))} className="editor-slider" />
            </section>

            {(fishType === "looper" || fishType === "anchor") && (
                <section className="editor-section">
                    <label className="editor-label">✍️ 動きを手書きで録画</label>
                    <div className="motion-canvas-wrapper">
                        <canvas ref={canvasRef} width={280} height={200} className="motion-canvas"
                            onPointerDown={() => { setMotionPath([]); setIsRecording(true); }}
                            onPointerMove={handlePointerMove}
                            onPointerUp={stopRecording} onPointerLeave={stopRecording} />
                        {isRecording && <div className="motion-recording-badge">録画中...</div>}
                    </div>
                    <div className="motion-actions">
                        <span className="editor-value">{motionPath.length}点</span>
                        <button className="btn btn--ghost" onClick={() => {
                            setMotionPath([]);
                            canvasRef.current?.getContext("2d")?.clearRect(0, 0, 280, 200);
                        }}>クリア</button>
                    </div>
                </section>
            )}

            <div className="editor-footer">
                <button className="btn btn--release" onClick={() => void handleRelease()} disabled={releasing}>
                    {releasing ? "放流中..." : "🌊 泳げ！"}
                </button>
            </div>
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
