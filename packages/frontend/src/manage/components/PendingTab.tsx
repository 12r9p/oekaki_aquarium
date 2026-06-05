import React, { useState } from "react";
import type { PendingFish } from "@aquarium/shared";
import { Button } from "@/components/ui/button";
import { api } from "@/shared/api";
import { Check, Trash2, Upload } from "lucide-react";
import { PageHeader } from "./PageHeader";

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
    const uploadFiles = async (files: FileList | File[]) => {
        for (const file of Array.from(files)) {
            if (file.type !== "image/png") continue;
            const form = new FormData();
            form.append("image", file);
            await api.request("/api/scan", { method: "POST", body: form });
        }
        onRefresh();
    };
    const releaseFish = async (fish: PendingFish) => {
        await api.request("/api/release", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id: fish.id,
                type: "school",
                textureUrl: fish.imageUrl,
                userParams: { scale: 0.8, speed: 1.0, rotationOffset: 0 }
            }),
        });
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
                                            onClick={() => releaseFish(f)}
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
        </div>
    );
}
