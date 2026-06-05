import React, { useState } from "react";
import type { FishDirection, FishType, PendingFish } from "@aquarium/shared";
import { Button } from "@/components/ui/button";
import { api } from "@/shared/api";
import { Check, FlipHorizontal2, Trash2, Upload, X } from "lucide-react";
import { PageHeader } from "./PageHeader";
import { MotionPreview } from "./MotionPage";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

interface PendingTabProps {
    pendingFish: PendingFish[];
    onRefresh: () => void;
}

export function PendingTab({ pendingFish, onRefresh }: PendingTabProps) {
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [releaseTarget, setReleaseTarget] = useState<PendingFish | null>(null);
    const uploadFiles = async (files: FileList | File[]) => {
        for (const file of Array.from(files)) {
            if (file.type !== "image/png") continue;
            const form = new FormData();
            form.append("image", file);
            await api.request("/api/scan", { method: "POST", body: form });
        }
        onRefresh();
    };
    const releaseFish = async (fish: PendingFish, options: { type: FishType; direction: FishDirection; flipX: boolean; opacity: number }) => {
        await api.request("/api/release", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id: fish.id,
                type: options.type,
                textureUrl: fish.imageUrl,
                userParams: { scale: 0.8, speed: 1.0, rotationOffset: 0, direction: options.direction, flipX: options.flipX, opacity: options.opacity }
            }),
        });
        setReleaseTarget(null);
        onRefresh();
    };

    const deletePending = async (id: string) => {
        await api.request(`/api/pending/${encodeURIComponent(id)}`, { method: "DELETE" });
        setPendingDeleteId(null);
        onRefresh();
    };

    return (
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
            <PageHeader
                title="承認待ち"
                description={`${pendingFish.length}匹が未処理です。画像を確認して放流または却下します。`}
                actions={<label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-sky-500 px-4 text-sm font-bold text-white hover:bg-sky-600"><Upload className="h-4 w-4" />PNGを追加<input type="file" accept="image/png" multiple hidden onChange={e => e.target.files && void uploadFiles(e.target.files)} /></label>}
            />
            <div className="mb-4 rounded-xl border-2 border-dashed border-sky-200 bg-sky-50 p-4 text-center text-sm text-sky-700"
                onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void uploadFiles(e.dataTransfer.files); }}>
                パラメーター入りPNGをドロップすると待機リストへ追加します
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <Table>
                    <TableHeader className="bg-slate-50">
                        <TableRow>
                            <TableHead className="w-16 text-center">画像</TableHead>
                            <TableHead>ID</TableHead>
                            <TableHead className="text-right w-32">操作</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {pendingFish.map(f => (
                            <TableRow key={f.id}>
                                <TableCell className="p-2 align-middle">
                                    <div className="w-12 h-12 bg-slate-100 rounded flex items-center justify-center p-1 border border-slate-200 mx-auto">
                                        <img src={f.imageUrl} alt="pending fish" className="max-w-full max-h-full object-contain" />
                                    </div>
                                </TableCell>
                                <TableCell className="align-middle">
                                    <span className="text-xs font-mono text-slate-500 bg-slate-50 px-2 py-1 rounded">
                                        {f.id.slice(0, 8)}
                                    </span>
                                </TableCell>
                                <TableCell className="text-right align-middle">
                                    <div className="flex justify-end gap-2">
                                        {pendingDeleteId === f.id ? (
                                            <>
                                                <span className="self-center text-xs font-bold text-rose-700">却下しますか？</span>
                                                <Button variant="outline" className="h-8 px-3 text-xs" onClick={() => setPendingDeleteId(null)}>キャンセル</Button>
                                                <Button variant="destructive" className="h-8 px-3 text-xs" onClick={() => void deletePending(f.id)}>却下</Button>
                                            </>
                                        ) : (
                                            <>
                                        <Button
                                            variant="default"
                                            className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold h-8 px-3 text-xs"
                                            onClick={() => setReleaseTarget(f)}
                                        >
                                            <Check className="w-3 h-3 mr-1" /> 放流
                                        </Button>
                                        <Button
                                            variant="outline"
                                            className="h-8 w-8 p-0 text-slate-500 hover:text-red-500 hover:bg-red-50 border-slate-300"
                                            onClick={() => setPendingDeleteId(f.id)}
                                            title="却下"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                            </>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
            {pendingFish.length === 0 && (
                <div className="text-slate-400 text-center py-12">待機中の魚はいません</div>
            )}
            {releaseTarget && (
                <ReleaseFishDialog
                    fish={releaseTarget}
                    onClose={() => setReleaseTarget(null)}
                    onRelease={options => void releaseFish(releaseTarget, options)}
                />
            )}
        </div>
    );
}

function ReleaseFishDialog({ fish, onClose, onRelease }: { fish: PendingFish; onClose: () => void; onRelease: (options: { type: FishType; direction: FishDirection; flipX: boolean; opacity: number }) => void }) {
    const [type, setType] = useState<FishType>(fish.fishMeta?.type ?? "school");
    const [direction, setDirection] = useState<FishDirection>(fish.fishMeta?.direction ?? "auto");
    const [flipX, setFlipX] = useState(fish.fishMeta?.flipX ?? false);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
            <div className="w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-2xl">
                <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
                    <div><h2 className="font-bold text-slate-900">魚を放流</h2><p className="mt-1 text-xs text-slate-500">動きと画像の向きを確認してから水槽に入れます。</p></div>
                    <Button variant="ghost" size="icon" onClick={onClose}><X className="h-5 w-5" /></Button>
                </div>
                <div className="grid gap-5 p-5 md:grid-cols-[220px_1fr]">
                    <div className="grid gap-3">
                        <div className="flex h-40 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <img src={fish.imageUrl} alt="pending fish" className="max-h-full max-w-full object-contain" style={{ transform: flipX ? "scaleX(-1)" : undefined }} />
                        </div>
                        <Button variant="outline" onClick={() => setFlipX(value => !value)} className="gap-1.5"><FlipHorizontal2 className="h-4 w-4" />画像を左右反転</Button>
                    </div>
                    <div className="grid gap-5">
                        <MotionPreview mode={type} large />
                        <div>
                            <div className="mb-2 text-xs font-bold text-slate-600">動きプリセット</div>
                            <div className="grid grid-cols-2 gap-2">
                                {MOTION_CHOICES.map(choice => (
                                    <button key={choice.type} type="button" onClick={() => setType(choice.type)} className={`rounded-lg border p-3 text-left text-xs ${type === choice.type ? "border-sky-500 bg-sky-50 text-sky-800" : "border-slate-200 bg-white text-slate-600"}`}>
                                        <div className="font-bold">{choice.label}</div>
                                        <div className="mt-1 text-[11px] opacity-75">{choice.description}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <div className="mb-2 text-xs font-bold text-slate-600">泳ぐ向き</div>
                            <div className="grid grid-cols-3 gap-2">
                                <div className={`rounded-lg border px-3 py-2 text-center text-xs font-bold ${direction === "auto" ? "border-slate-300 bg-slate-100 text-slate-500" : "border-slate-200 bg-slate-50 text-slate-400"}`}>自動</div>
                                <button type="button" onClick={() => setDirection("left")} className={`rounded-lg border px-3 py-2 text-xs font-bold ${direction === "left" ? "border-sky-500 bg-sky-50 text-sky-800" : "border-slate-200"}`}>← 左</button>
                                <button type="button" onClick={() => setDirection("right")} className={`rounded-lg border px-3 py-2 text-xs font-bold ${direction === "right" ? "border-sky-500 bg-sky-50 text-sky-800" : "border-slate-200"}`}>右 →</button>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={onClose}>キャンセル</Button>
                            <Button onClick={() => onRelease({ type, direction, flipX, opacity: 1 })}>放流</Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

const MOTION_CHOICES: Array<{ type: FishType; label: string; description: string }> = [
    { type: "school", label: "横に移動", description: "標準的に水平方向へ泳ぐ" },
    { type: "jellyfish", label: "浮遊主体", description: "上下に漂う動き" },
    { type: "anchor", label: "固定", description: "その場に留める" },
    { type: "tuna", label: "速く移動", description: "直線的に大きく泳ぐ" },
    { type: "squid", label: "パルス移動", description: "止まりながら進む" },
    { type: "custom", label: "カスタム", description: "管理画面のカスタム泳ぎ" },
];
