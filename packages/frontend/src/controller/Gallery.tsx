import { useState, useEffect, useCallback, useRef } from "react";
import type { PendingFish } from "@aquarium/shared";
import { api } from "../shared/api";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";

interface GalleryProps {
    onSelect: (fish: PendingFish) => void;
}

const EDITOR_ID = `editor-${Math.random().toString(36).slice(2, 8)}`;

export function Gallery({ onSelect }: GalleryProps): React.ReactElement {
    const [fishList, setFishList] = useState<PendingFish[]>([]);
    const [loading, setLoading] = useState(true);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchPending = useCallback(async (): Promise<void> => {
        try {
            const res = await api.request("/api/pending");
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
        const res = await api.request("/api/pending/lock", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fishId: fish.id, editorUuid: EDITOR_ID }),
        });
        if (!res.ok) { alert("ロックに失敗しました"); return; }
        const { fish: locked } = await res.json() as { fish: PendingFish };
        onSelect(locked);
    };

    const uploadFiles = async (files: FileList | File[]) => {
        for (const file of Array.from(files)) {
            if (!file.type.startsWith("image/")) continue;
            const form = new FormData();
            form.append("image", file);
            form.append("autoProcess", "true");
            await api.request("/api/scan", { method: "POST", body: form });
        }
        await fetchPending();
    };

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900">
            <header className="border-b border-slate-200 bg-white px-5 py-4">
                <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-xl font-bold tracking-tight">待合室</h1>
                        <p className="mt-1 text-sm text-slate-500">自分の絵を選んで、泳ぎ方を設定します。</p>
                    </div>
                    <Button className="gap-2" onClick={() => fileInputRef.current?.click()}>
                        <Upload className="h-4 w-4" />写真・PNGを追加
                    </Button>
                    <input type="file" ref={fileInputRef} accept="image/png,image/*" capture="environment" multiple className="hidden"
                        onChange={e => e.target.files && void uploadFiles(e.target.files)} />
                </div>
            </header>
            <div className="mx-auto max-w-5xl px-5 py-5">
                <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void uploadFiles(e.dataTransfer.files); }}
                className="mb-5 rounded-lg border border-dashed border-slate-300 bg-white px-4 py-4 text-center text-sm text-slate-500">
                PNGをここへドロップ
            </div>
            {loading ? (
                <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">読み込み中...</div>
            ) : fishList.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-white p-10 text-center">
                    <p className="font-semibold text-slate-800">まだ魚がいません</p>
                    <p className="mt-1 text-sm text-slate-500">スキャナーで絵を取り込んでください</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {fishList.map((fish) => (
                        <button
                            key={fish.id}
                            className={`relative aspect-square overflow-hidden rounded-lg border bg-white p-3 shadow-sm transition hover:border-sky-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 ${fish.lockedBy ? "border-amber-200" : "border-slate-200"}`}
                            onClick={() => void handleSelect(fish)}
                            disabled={!!fish.lockedBy}
                        >
                            <img src={fish.imageUrl} alt="fish" className="h-full w-full object-contain" />
                            {fish.lockedBy && <div className="absolute right-2 top-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">編集中</div>}
                        </button>
                    ))}
                </div>
            )}
            </div>
        </div>
    );
}
