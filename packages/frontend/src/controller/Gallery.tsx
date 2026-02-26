import { useState, useEffect, useCallback } from "react";
import type { PendingFish } from "@aquarium/shared";
import "./Gallery.css";

interface GalleryProps {
    onSelect: (fish: PendingFish) => void;
}

const EDITOR_ID = `editor-${Math.random().toString(36).slice(2, 8)}`;

export function Gallery({ onSelect }: GalleryProps): React.ReactElement {
    const [fishList, setFishList] = useState<PendingFish[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchPending = useCallback(async (): Promise<void> => {
        try {
            const res = await fetch("/api/pending");
            setFishList(await res.json() as PendingFish[]);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchPending();
        const t = setInterval(() => void fetchPending(), 3_000);
        return () => clearInterval(t);
    }, [fetchPending]);

    const handleSelect = async (fish: PendingFish): Promise<void> => {
        if (fish.lockedBy) { alert("この魚は現在編集中です"); return; }
        const res = await fetch("/api/pending/lock", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fishId: fish.id, editorUuid: EDITOR_ID }),
        });
        if (!res.ok) { alert("ロックに失敗しました"); return; }
        const { fish: locked } = await res.json() as { fish: PendingFish };
        onSelect(locked);
    };

    return (
        <div className="gallery">
            <header className="gallery-header">
                <h1>🐟 待合室</h1>
                <p className="gallery-subtitle">自分の絵をタップして設定しよう！</p>
            </header>
            {loading ? (
                <div className="gallery-empty">読み込み中...</div>
            ) : fishList.length === 0 ? (
                <div className="gallery-empty">
                    <p>まだ魚がいません</p>
                    <p>スキャナーで絵を取り込んでください</p>
                </div>
            ) : (
                <div className="gallery-grid">
                    {fishList.map((fish) => (
                        <button
                            key={fish.id}
                            className={`gallery-card ${fish.lockedBy ? "locked" : ""}`}
                            onClick={() => void handleSelect(fish)}
                            disabled={!!fish.lockedBy}
                        >
                            <img src={fish.imageUrl} alt="fish" className="gallery-card-image" />
                            {fish.lockedBy && <div className="gallery-card-lock">編集中</div>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
