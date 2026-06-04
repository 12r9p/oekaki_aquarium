import React, { useState } from "react";
import type { ActiveFish } from "@aquarium/shared";
import { LAYER_CONFIG } from "@aquarium/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Trash2, Pin, Archive, CopyPlus, Loader2, RefreshCw, X, Settings2 } from "lucide-react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

/** /api/library から返るエントリ型 */
interface LibraryEntry {
    filename: string;
    imageUrl: string;
    meta: {
        version: number;
        author: string;
        type: "swimmer" | "looper" | "anchor";
        speed: number;
        scale: number;
        pinnedLayerId: number | null;
        tags: string[];
    };
}

interface FishTabProps {
    activeFish: ActiveFish[];
    onRefresh: () => void;
}

/** 魚コンフィグポップアップ */
function FishConfigPopup({
    fish,
    onUpdate,
    onDelete,
    onDuplicate,
    onClose,
    confirmMode,
}: {
    fish: ActiveFish;
    onUpdate: (id: string, updates: Record<string, unknown>) => void;
    onDelete: (id: string) => void;
    onDuplicate: (id: string) => void;
    onClose: () => void;
    confirmMode: boolean;
}) {
    const [scale, setScale] = useState(fish.userParams.scale);
    const [speed, setSpeed] = useState(fish.userParams.speed);
    const [pinnedLayerId, setPinnedLayerId] = useState(fish.pinnedLayerId ?? 0);
    const [isPinned, setIsPinned] = useState(fish.isPinned);
    const [isArchived, setIsArchived] = useState(!!fish.isArchived);
    const [type, setType] = useState(fish.type);
    // 削除確認インラインUIの表示状態
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    // fish.id が変化したとき（別の魚を選択）にローカルstateを同期する
    React.useEffect(() => {
        setScale(fish.userParams.scale);
        setSpeed(fish.userParams.speed);
        setPinnedLayerId(fish.pinnedLayerId ?? 0);
        setIsPinned(fish.isPinned);
        setIsArchived(!!fish.isArchived);
        setType(fish.type);
        setShowDeleteConfirm(false);
    }, [fish.id]);

    // デバウンス付き即時反映（スライダ高速操作時のAPI過負荷防止）
    const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const debouncedUpdate = (updates: Record<string, unknown>) => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            onUpdate(fish.id, updates);
        }, 120);
    };

    const handleType = (val: string) => {
        setType(val as typeof type);
        onUpdate(fish.id, { type: val });
    };
    const handleScale = (val: number) => {
        setScale(val);
        debouncedUpdate({ scale: val });
    };
    const handleSpeed = (val: number) => {
        setSpeed(val);
        debouncedUpdate({ speed: val });
    };
    const handleIsPinned = (val: boolean) => {
        setIsPinned(val);
        onUpdate(fish.id, { isPinned: val, pinnedLayerId: val ? pinnedLayerId : undefined });
    };
    const handlePinnedLayerId = (val: number) => {
        setPinnedLayerId(val);
        debouncedUpdate({ isPinned: true, pinnedLayerId: val });
    };
    const handleIsArchived = (val: boolean) => {
        setIsArchived(val);
        onUpdate(fish.id, { isArchived: val });
    };

    // クリーンアップ
    React.useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden">
                {/* ヘッダー */}
                <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
                    <div className="w-14 h-14 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 flex items-center justify-center flex-shrink-0">
                        <img src={fish.textureUrl} alt="fish" className="max-w-full max-h-full object-contain" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-xs font-mono text-slate-400 truncate">{fish.id}</div>
                        <div className="text-sm font-bold text-slate-800 truncate">{fish.author ?? "anonymous"}</div>
                        <div className="text-[10px] text-slate-400">Layer: {fish.layerIndex} {fish.isPinned && <span className="text-sky-500">📌 Pinned</span>}</div>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors flex-shrink-0">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* フォーム */}
                <div className="p-5 flex flex-col gap-5 overflow-y-auto">
                    {/* 動きタイプ */}
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">動きタイプ</label>
                        <div className="grid grid-cols-3 gap-1.5">
                            {[
                                { val: "tuna", label: "🐟 マグロ" },
                                { val: "school", label: "🐠 イワシ群れ" },
                                { val: "squid", label: "🦑 イカ" },
                                { val: "jellyfish", label: "🪼 クラゲ" },
                                { val: "shark", label: "🦈 サメ" },
                                { val: "anchor", label: "🌿 固定" },
                            ].map(({ val, label }) => (
                                <button
                                    key={val}
                                    onClick={() => handleType(val)}
                                    className={`text-xs py-1.5 px-2 rounded-lg border font-medium transition-all ${type === val ? "bg-sky-500 text-white border-sky-500 shadow-sm" : "bg-slate-50 text-slate-600 border-slate-200 hover:border-sky-300 hover:bg-sky-50"}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* スライダー系 */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">スケール <span className="font-mono text-sky-600">{scale.toFixed(2)}</span></label>
                            <input
                                type="range" min="0.1" max="3.0" step="0.05"
                                value={scale}
                                onChange={e => handleScale(Number(e.target.value))}
                                className="w-full accent-sky-500"
                            />
                            <div className="flex justify-between text-[10px] text-slate-400">
                                <span>0.1</span><span>1.0</span><span>3.0</span>
                            </div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">速度 <span className="font-mono text-emerald-600">{speed.toFixed(2)}</span></label>
                            <input
                                type="range" min="0" max="5.0" step="0.05"
                                value={speed}
                                onChange={e => handleSpeed(Number(e.target.value))}
                                className="w-full accent-emerald-500"
                            />
                            <div className="flex justify-between text-[10px] text-slate-400">
                                <span>0</span><span>1.0</span><span>5.0</span>
                            </div>
                        </div>
                    </div>

                    {/* 数値入力 */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-slate-500 font-bold uppercase">Scale (数値入力)</label>
                            <Input type="number" step="0.05" min="0.1" max="3.0"
                                value={scale}
                                onChange={e => handleScale(Number(e.target.value))}
                                className="h-8 text-xs text-right font-mono"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-slate-500 font-bold uppercase">Speed (数値入力)</label>
                            <Input type="number" step="0.05" min="0" max="5.0"
                                value={speed}
                                onChange={e => handleSpeed(Number(e.target.value))}
                                className="h-8 text-xs text-right font-mono"
                            />
                        </div>
                    </div>

                    {/* ピン留め */}
                    <div className="flex flex-col gap-2 bg-slate-50 rounded-xl p-3 border border-slate-100">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={isPinned}
                                onChange={e => handleIsPinned(e.target.checked)}
                                className="w-4 h-4 rounded text-sky-500"
                            />
                            <Pin className="w-4 h-4 text-sky-500" />
                            <span className="text-sm font-semibold text-slate-700">レイヤーにピン留め</span>
                        </label>
                        {isPinned && (
                            <div className="flex items-center gap-2 ml-6">
                                <label className="text-xs text-slate-500 w-16">Layer ID</label>
                                <Input
                                    type="number" min="0" max={LAYER_CONFIG.length - 1}
                                    value={pinnedLayerId}
                                    onChange={e => handlePinnedLayerId(Math.max(0, Math.min(Number(e.target.value), LAYER_CONFIG.length - 1)))}
                                    className="h-7 w-20 text-xs text-center font-mono border-sky-200 bg-sky-50/50"
                                />
                            </div>
                        )}
                    </div>

                    {/* アーカイブ */}
                    <label className="flex items-center gap-2 cursor-pointer bg-amber-50 rounded-xl p-3 border border-amber-100">
                        <input
                            type="checkbox"
                            checked={isArchived}
                            onChange={e => setIsArchived(e.target.checked)}
                            className="w-4 h-4 rounded text-amber-500"
                        />
                        <Archive className="w-4 h-4 text-amber-500" />
                        <div>
                            <div className="text-sm font-semibold text-slate-700">アーカイブ（非表示）</div>
                            <div className="text-[10px] text-slate-400">水槽から隠しますが削除はしません</div>
                        </div>
                    </label>
                </div>

                {/* フッター */}
                <div className="flex items-center gap-2 px-5 py-4 border-t border-slate-100 bg-slate-50/50">
                    {showDeleteConfirm ? (
                        /* 削除確認 UI */
                        <>
                            <span className="text-sm text-red-600 font-semibold">🗑️ 本当に削除しますか?</span>
                            <Button
                                variant="ghost" size="sm"
                                className="text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                                onClick={() => setShowDeleteConfirm(false)}
                            >
                                キャンセル
                            </Button>
                            <Button
                                size="sm"
                                className="bg-red-500 hover:bg-red-600 text-white gap-1"
                                onClick={() => { onDelete(fish.id); onClose(); }}
                            >
                                <Trash2 className="w-3.5 h-3.5" /> 削除する
                            </Button>
                        </>
                    ) : (
                        /* 通常アクション */
                        <>
                            <Button
                                variant="ghost" size="sm"
                                className="text-stone-500 hover:text-stone-700 hover:bg-stone-100 gap-1.5"
                                onClick={() => { onDuplicate(fish.id); onClose(); }}
                            >
                                <CopyPlus className="w-4 h-4" /> 複製
                            </Button>
                            <Button
                                variant="ghost" size="sm"
                                className="text-red-500 hover:text-red-600 hover:bg-red-50 gap-1.5"
                                onClick={() => {
                                    if (confirmMode) {
                                        setShowDeleteConfirm(true);
                                    } else {
                                        onDelete(fish.id); onClose();
                                    }
                                }}
                            >
                                <Trash2 className="w-4 h-4" /> 削除
                            </Button>
                            <Button
                                variant="outline"
                                className="ml-auto px-6"
                                onClick={onClose}
                            >
                                閉じる
                            </Button>
                        </>
                    )}
                </div>
            </div>
        </div >
    );
}

export function FishTab({ activeFish, onRefresh }: FishTabProps) {
    const [galleryImages, setGalleryImages] = useState<Array<{ url: string; meta?: LibraryEntry["meta"] }>>([]);
    const [isGalleryOpen, setIsGalleryOpen] = useState(false);
    const [isReloading, setIsReloading] = useState(false);
    const [selectedFish, setSelectedFish] = useState<ActiveFish | null>(null);
    // 削除確認モード（true = 削除前に確認する）
    const [confirmMode, setConfirmMode] = useState(true);

    React.useEffect(() => {
        fetch("/api/gallery").then(res => res.json()).then(data => {
            if (data.images) setGalleryImages(data.images);
        }).catch(e => console.error("Gallery fetch error:", e));
    }, []);

    const reloadFromDisk = async () => {
        setIsReloading(true);
        try {
            await fetch("/api/library/reload", { method: "POST" });
            onRefresh();
        } catch (e) {
            console.error("[Library] reload error:", e);
        } finally {
            setIsReloading(false);
        }
    };

    const addFromGallery = async (entry: { url: string; meta?: LibraryEntry["meta"] }) => {
        const type = entry.meta?.type ?? "swimmer";
        const scale = entry.meta?.scale ?? 1.0;
        const speed = entry.meta?.speed ?? 1.0;
        const author = entry.meta?.author ?? "anonymous";
        const url = entry.url;

        try {
            const scanRes = await fetch("/api/scan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ deviceId: "demo-gallery", imageUrl: url, imageLocalPath: url })
            });
            const scanData = await scanRes.json() as { fish?: { id: string; imageUrl: string }; fishId?: string; error?: string };

            const fishId = scanData.fish?.id ?? scanData.fishId;
            const textureUrl = scanData.fish?.imageUrl ?? url;

            if (!fishId) {
                console.error("[addFromGallery] scan API失敗:", scanData);
                return;
            }

            const releaseRes = await fetch("/api/release", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: fishId, type, textureUrl, author,
                    userParams: { scale, speed, rotationOffset: 0 }
                })
            });
            if (!releaseRes.ok) return;
            onRefresh();
        } catch (e) {
            console.error("[addFromGallery] Error:", e);
        }
    };

    const updateFish = async (id: string, updates: Record<string, unknown>) => {
        await fetch(`/api/fish/${encodeURIComponent(id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
        });
        onRefresh();
    };

    const duplicateFish = async (id: string) => {
        await fetch(`/api/fish/${encodeURIComponent(id)}/duplicate`, { method: "POST" });
        onRefresh();
    };

    const deleteFish = async (id: string) => {
        await fetch(`/api/fish/${encodeURIComponent(id)}`, { method: "DELETE" });
        onRefresh();
    };

    return (
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50 flex flex-col gap-6">
            {/* ヘッダー */}
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-800">水槽の魚一覧 ({activeFish.length}匹)</h2>
                <div className="flex gap-2">
                    {/* 削除確認モードトグル */}
                    <button
                        onClick={() => setConfirmMode(m => !m)}
                        title={confirmMode ? "削除時に確認あり" : "削除時に確認なし"}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${confirmMode
                            ? "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                            : "bg-red-50 border-red-200 text-red-600 hover:bg-red-100"
                            }`}
                    >
                        {confirmMode ? (
                            <><span className="text-base">🛡️</span> 確認あり</>
                        ) : (
                            <><span className="text-base">⚡</span> 確認なし</>
                        )}
                    </button>
                    <Button
                        variant="outline"
                        onClick={reloadFromDisk}
                        disabled={isReloading}
                        className="bg-white gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50"
                    >
                        {isReloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                        /data/fish 再読み込み
                    </Button>
                    <Button
                        variant="outline"
                        onClick={async () => {
                            await fetch("/api/fish/redistribute", { method: "POST" });
                        }}
                        className="bg-white gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                        title="worldサイズ変更後に魚が偏った場合、全体に再均等配置します"
                    >
                        🌊 全魚を再配置
                    </Button>

                    <Button variant="outline" onClick={() => setIsGalleryOpen(!isGalleryOpen)} className="bg-white">
                        {isGalleryOpen ? "ギャラリーを閉じる" : "ギャラリーから追加"}
                    </Button>
                </div>
            </div>

            {/* --- ギャラリー表示エリア --- */}
            {isGalleryOpen && (
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                    <h3 className="text-sm font-bold text-slate-700 mb-3">テンプレートギャラリー (クリックで放流)</h3>
                    <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-3 overflow-y-auto max-h-48 p-2 bg-slate-50 rounded-lg border border-slate-100">
                        {galleryImages.length > 0 ? galleryImages.map((entry, idx) => (
                            <div
                                key={idx}
                                onClick={() => addFromGallery(entry)}
                                className="flex flex-col gap-1.5 aspect-square bg-white rounded cursor-pointer border border-transparent hover:border-emerald-500 hover:shadow-md transition-all p-1"
                            >
                                <div className="flex-1 overflow-hidden flex items-center justify-center">
                                    <img src={entry.url} alt={`gallery-${idx}`} className="max-w-full max-h-full object-contain" loading="lazy" />
                                </div>
                            </div>
                        )) : (
                            <div className="col-span-full text-xs text-slate-400 text-center py-4">テンプレートが見つかりません<br /><code className="text-[10px]">/server/src/public/images</code></div>
                        )}
                    </div>
                </div>
            )}

            {/* --- レイヤー所属状況の視覚化 --- */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                <h3 className="text-sm font-bold text-slate-700 mb-3">レイヤーの混雑状況 (自動押し出し)</h3>
                <div className="flex flex-col gap-3">
                    {LAYER_CONFIG.map((conf, idx) => {
                        const inLayer = activeFish.filter(f => !f.isPinned && f.layerIndex === idx && !f.isArchived);
                        const count = inLayer.length;
                        const max = conf.maxCount;
                        const ratio = Math.min(count / max, 1);
                        const isFull = count >= max;
                        return (
                            <div key={conf.id} className="flex items-center gap-3">
                                <div className="w-16 text-[11px] font-bold text-slate-500 text-right mt-0.5">Lyr {conf.id}</div>
                                <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden relative border border-slate-200 outline outline-1 outline-white mt-1">
                                    <div
                                        className={`absolute top-0 left-0 h-full transition-all duration-300 ${isFull ? "bg-amber-400" : "bg-emerald-400"}`}
                                        style={{ width: `${ratio * 100}%` }}
                                    />
                                </div>
                                <div className={`w-12 text-xs font-mono text-right mt-0.5 ${isFull ? "text-amber-600 font-bold" : "text-slate-500"}`}>
                                    {count}/{max}
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="mt-3 text-[10px] text-slate-400 leading-snug">
                    ※最前面(Lyr0)がいっぱいになると、順次奥のレイヤーへ押し出されます。ピン留めされた魚は定員({LAYER_CONFIG.reduce((acc, c) => acc + c.maxCount, 0)}匹)から除外されます。
                </div>
            </div>

            {/* --- 魚テーブル --- */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 max-h-[60vh] overflow-y-auto">
                <Table>
                    <TableHeader className="bg-slate-50">
                        <TableRow>
                            <TableHead className="w-16 text-center">画像</TableHead>
                            <TableHead>情報</TableHead>
                            <TableHead className="w-24 text-center">タイプ</TableHead>
                            <TableHead className="w-24 text-center">Scale / Speed</TableHead>
                            <TableHead className="w-24 text-center">ステータス</TableHead>
                            <TableHead className="text-right w-16">操作</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {activeFish.map(f => (
                            <FishRow
                                key={f.id}
                                fish={f}
                                onEdit={() => setSelectedFish(f)}
                                onDuplicate={duplicateFish}
                                onDelete={deleteFish}
                                confirmMode={confirmMode}
                            />
                        ))}
                    </TableBody>
                </Table>
            </div>
            {activeFish.length === 0 && (
                <div className="text-slate-400 text-center py-12">現在水槽に魚はいません</div>
            )}

            {/* --- 魚コンフィグポップアップ --- */}
            {selectedFish && (
                <FishConfigPopup
                    fish={selectedFish}
                    onUpdate={updateFish}
                    onDelete={deleteFish}
                    onDuplicate={duplicateFish}
                    onClose={() => setSelectedFish(null)}
                    confirmMode={confirmMode}
                />
            )}
        </div>
    );
}

function FishRow({
    fish,
    onEdit,
    onDuplicate,
    onDelete,
    confirmMode,
}: {
    fish: ActiveFish;
    onEdit: () => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
    confirmMode: boolean;
}) {
    // 確認モード時のインライン確認状態
    const [pendingDelete, setPendingDelete] = useState(false);
    const typeLabel: Record<string, string> = {
        tuna: "🐟 マグロ", school: "🐠 イワシ", squid: "🦑 イカ",
        jellyfish: "🪼 クラゲ", shark: "🦈 サメ", anchor: "🌿 固定",
        swimmer: "swimmer", looper: "looper",
    };

    return (
        <TableRow
            className={`cursor-pointer hover:bg-sky-50/50 transition-colors ${fish.isArchived ? "opacity-50" : ""}`}
            onClick={onEdit}
        >
            {/* 画像 */}
            <TableCell className="p-2 align-middle border-r border-slate-100 relative">
                <div className="w-12 h-12 bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center border border-slate-200 mx-auto">
                    <img src={fish.textureUrl} alt="fish" className="max-w-full max-h-full object-contain" />
                </div>
                {fish.isArchived && (
                    <div className="absolute top-1 right-1 bg-slate-700 text-white text-[9px] px-1 rounded">Arcv</div>
                )}
                {fish.isPinned && (
                    <div className="absolute top-1 left-1 text-sky-500 text-[10px]">📌</div>
                )}
            </TableCell>

            {/* 情報 */}
            <TableCell className="align-middle border-r border-slate-100">
                <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-bold text-slate-700 truncate max-w-[160px]">{fish.author ?? "anonymous"}</span>
                    <span className="text-[10px] font-mono text-slate-400">{fish.id.slice(0, 12)}…</span>
                    <span className="text-[10px] text-slate-400">Lyr {fish.layerIndex}</span>
                </div>
            </TableCell>

            {/* タイプ */}
            <TableCell className="align-middle border-r border-slate-100 text-center">
                <span className="text-[11px] font-bold bg-sky-50 text-sky-700 px-2 py-0.5 rounded-full border border-sky-100">
                    {typeLabel[fish.type] ?? fish.type}
                </span>
            </TableCell>

            {/* パラメータ */}
            <TableCell className="align-middle border-r border-slate-100 text-center">
                <div className="flex flex-col text-[11px] font-mono gap-0.5">
                    <span className="text-slate-600">×<span className="text-sky-600 font-bold">{fish.userParams.scale.toFixed(2)}</span></span>
                    <span className="text-slate-600">⚡<span className="text-emerald-600 font-bold">{fish.userParams.speed.toFixed(2)}</span></span>
                </div>
            </TableCell>

            {/* ステータス */}
            <TableCell className="align-middle border-r border-slate-100 text-center">
                <div className="flex flex-col gap-0.5 items-center">
                    {fish.isPinned && <span className="text-[10px] bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded-full">📌 固定</span>}
                    {fish.isArchived && <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">🗃️ Arcv</span>}
                    {!fish.isPinned && !fish.isArchived && <span className="text-[10px] text-slate-300">—</span>}
                </div>
            </TableCell>

            {/* 操作 */}
            <TableCell className="text-right align-middle" onClick={e => e.stopPropagation()}>
                {pendingDelete ? (
                    /* 確認 UI （設定アイコン隔に表示） */
                    <div className="flex justify-end items-center gap-1">
                        <span className="text-[10px] text-red-600 font-bold">?</span>
                        <Button
                            variant="ghost" size="sm"
                            className="h-7 px-1.5 text-[10px] text-slate-500 hover:bg-slate-100"
                            onClick={() => setPendingDelete(false)}
                        >
                            No
                        </Button>
                        <Button
                            size="sm"
                            className="h-7 px-1.5 text-[10px] bg-red-500 hover:bg-red-600 text-white"
                            onClick={() => { onDelete(fish.id); setPendingDelete(false); }}
                        >
                            Yes
                        </Button>
                    </div>
                ) : (
                    <div className="flex justify-end gap-1">
                        <Button
                            variant="ghost" size="sm"
                            className="text-sky-500 hover:text-sky-700 hover:bg-sky-50 h-8 w-8 p-0"
                            onClick={() => onEdit()}
                            title="設定"
                        >
                            <Settings2 className="w-4 h-4" />
                        </Button>
                        <Button
                            variant="ghost" size="sm"
                            className="text-stone-500 hover:text-stone-700 hover:bg-stone-100 h-8 w-8 p-0"
                            onClick={() => onDuplicate(fish.id)}
                            title="複製"
                        >
                            <CopyPlus className="w-4 h-4" />
                        </Button>
                        <Button
                            variant="ghost" size="sm"
                            className="text-red-500 hover:text-red-600 hover:bg-red-50 h-8 w-8 p-0"
                            onClick={() => {
                                if (confirmMode) {
                                    setPendingDelete(true);
                                } else {
                                    onDelete(fish.id);
                                }
                            }}
                            title="削除"
                        >
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    </div>
                )}
            </TableCell>
        </TableRow>
    );
}
