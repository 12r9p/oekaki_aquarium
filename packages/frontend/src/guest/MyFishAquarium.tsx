import { useEffect, useMemo, useRef, useState } from "react";
import type { ActiveFish } from "@aquarium/shared";
import { api } from "../shared/api";
import { ArrowLeft, Fish, RefreshCw } from "lucide-react";

const OWNED_KEY = "aquarium-owned-fish";

function readOwnedFish(): string[] {
    try {
        const values: unknown = JSON.parse(localStorage.getItem(OWNED_KEY) ?? "[]");
        return Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : [];
    } catch { return []; }
}

export function MyFishAquarium({ onBack }: { onBack: () => void }): React.ReactElement {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [ownedIds, setOwnedIds] = useState<string[]>(readOwnedFish);
    const [fish, setFish] = useState<ActiveFish[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const ownFish = useMemo(() => fish.filter(item => ownedIds.includes(item.id) && !item.isArchived), [fish, ownedIds]);

    const refresh = async (): Promise<void> => {
        try {
            const response = await api.request("/api/state", { cache: "no-store" });
            if (!response.ok) throw new Error("state unavailable");
            const state = await response.json() as { activeFish?: ActiveFish[] };
            setFish(state.activeFish ?? []);
            setFailed(false);
        } catch { setFailed(true); }
        finally { setLoading(false); }
    };

    useEffect(() => {
        const sharedFishId = new URLSearchParams(location.search).get("fish");
        if (sharedFishId) {
            const nextIds = [...new Set([...readOwnedFish(), sharedFishId])];
            localStorage.setItem(OWNED_KEY, JSON.stringify(nextIds));
            setOwnedIds(nextIds);
            history.replaceState(null, "", `${location.pathname}#my-fish`);
        }
        void refresh();
        const timer = window.setInterval(() => void refresh(), 12_000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        const resize = (): void => {
            const bounds = canvas.getBoundingClientRect();
            const ratio = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.max(1, Math.floor(bounds.width * ratio));
            canvas.height = Math.max(1, Math.floor(bounds.height * ratio));
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
        };
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(canvas);
        const images = new Map<string, HTMLImageElement>();
        const startedAt = performance.now();
        let frameId = 0;
        const draw = (now: number): void => {
            const width = canvas.clientWidth;
            const height = canvas.clientHeight;
            context.clearRect(0, 0, width, height);
            context.fillStyle = "#0c3945";
            context.fillRect(0, 0, width, height);
            context.strokeStyle = "#82d1c52b";
            context.lineWidth = 1;
            for (let row = 1; row < 5; row++) {
                context.beginPath();
                context.ellipse(width * .5, height * (row / 5), width * .52, 12, Math.sin(now / 1700 + row) * .04, 0, Math.PI * 2);
                context.stroke();
            }
            ownFish.forEach((item, index) => {
                let image = images.get(item.id);
                if (!image) {
                    image = new Image();
                    image.decoding = "async";
                    image.src = item.textureUrl;
                    images.set(item.id, image);
                }
                if (!image.complete || !image.naturalWidth) return;
                const phase = index * 1.71;
                const x = width * (.14 + ((now - startedAt) / 18000 + phase * .23) % .72);
                const y = height * (.3 + .4 * ((Math.sin(now / 1900 + phase) + 1) / 2));
                const displayWidth = Math.min(120, width * .24);
                const displayHeight = displayWidth * image.naturalHeight / image.naturalWidth;
                context.save();
                context.globalAlpha = item.userParams.opacity ?? 1;
                if (item.userParams.direction === "left" || (item.userParams.direction === "auto" && index % 2 === 1)) {
                    context.translate(x + displayWidth / 2, y);
                    context.scale(-1, 1);
                    context.drawImage(image, -displayWidth / 2, -displayHeight / 2, displayWidth, displayHeight);
                } else {
                    context.drawImage(image, x - displayWidth / 2, y - displayHeight / 2, displayWidth, displayHeight);
                }
                context.restore();
            });
            frameId = requestAnimationFrame(draw);
        };
        frameId = requestAnimationFrame(draw);
        return () => { cancelAnimationFrame(frameId); observer.disconnect(); };
    }, [ownFish]);

    return <main className="my-fish-page">
        <header className="my-fish-header"><button onClick={onBack} aria-label="エサやりへ戻る"><ArrowLeft size={18} /></button><div><span>お絵かき水族館</span><h1>自分の魚</h1></div><button onClick={() => void refresh()} aria-label="魚を更新"><RefreshCw size={17} /></button></header>
        <section className="my-fish-tank" aria-label="自分が放流した魚だけが泳ぐ水槽"><canvas ref={canvasRef} /><div className="my-fish-tank-label"><span className="my-fish-pulse" />MY AQUARIUM · {ownFish.length}匹</div></section>
        <section className="my-fish-content"><div className="my-fish-heading"><div><p>この端末に保存した魚</p><h2>あなたのコレクション</h2></div><span>{ownFish.length}匹</span></div>
            {loading ? <div className="my-fish-state" role="status">水槽を準備しています…</div> : failed && ownFish.length === 0 ? <div className="my-fish-state"><strong>水槽に接続できません</strong><span>ネットワークを確認して、もう一度更新してください。</span></div> : ownFish.length === 0 ? <div className="my-fish-state"><Fish size={30} /><strong>まだ魚がいません</strong><span>魚の放流後に、ここへ自分の魚が表示されます。</span></div> : <div className="my-fish-list">{ownFish.map(item => <article key={item.id}><img src={item.textureUrl} alt={`${item.author || "あなた"}の魚`} loading="lazy" /><div><strong>{item.author || "あなたの魚"}</strong><span>放流 {new Date(item.releasedAt).toLocaleDateString("ja-JP")}</span></div></article>)}</div>}
            {failed && ownFish.length > 0 && <p className="my-fish-offline" role="status">接続が切れています。保存済みの魚を表示しています。</p>}
        </section>
    </main>;
}
