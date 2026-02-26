import React from "react";
import type { PendingFish } from "@aquarium/shared";
import { Button } from "@/components/ui/button";
import { Check, Trash2 } from "lucide-react";

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
    const releaseFish = async (fish: PendingFish) => {
        await fetch("/api/release", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id: fish.id,
                type: "swimmer",
                textureUrl: fish.imageUrl,
                userParams: { scale: 0.8, speed: 1.0, rotationOffset: 0 }
            }),
        });
        onRefresh();
    };

    const deletePending = async (id: string) => {
        if (!confirm("この待機中の魚を削除（拒否）しますか？")) return;
        await fetch(`/api/pending/${encodeURIComponent(id)}`, { method: "DELETE" });
        onRefresh();
    };

    return (
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
            <h2 className="text-xl font-bold text-slate-800 mb-4">待機中の魚一覧 ({pendingFish.length}匹)</h2>
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
                                            onClick={() => deletePending(f.id)}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
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
