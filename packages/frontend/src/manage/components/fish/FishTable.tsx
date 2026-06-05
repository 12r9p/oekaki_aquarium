import { useState } from "react";
import type { ActiveFish } from "@aquarium/shared";
import { CopyPlus, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getLayerColor, getLayerLabel } from "./layer-colors";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

interface FishTableProps {
    activeFish: ActiveFish[];
    onEdit: (fish: ActiveFish) => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
}

export function FishTable({ activeFish, onEdit, onDuplicate, onDelete }: FishTableProps) {
    const [sort, setSort] = useState<"released-new" | "released-old" | "created-new" | "archived-new">("released-new");
    const sortedFish = [...activeFish].sort((a, b) => {
        if (sort === "created-new") return b.createdAt - a.createdAt;
        if (sort === "archived-new") return (b.archivedAt ?? 0) - (a.archivedAt ?? 0);
        if (sort === "released-old") return a.releasedAt - b.releasedAt;
        return b.releasedAt - a.releasedAt;
    });
    return (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 max-h-[60vh] overflow-y-auto">
            <div className="sticky top-0 z-10 flex justify-end border-b border-slate-200 bg-white p-3">
                <Select value={sort} onValueChange={value => setSort(value as typeof sort)}>
                    <SelectTrigger className="h-8 w-40 text-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="released-new">放流: 新しい順</SelectItem>
                        <SelectItem value="released-old">放流: 古い順</SelectItem>
                        <SelectItem value="created-new">作成: 新しい順</SelectItem>
                        <SelectItem value="archived-new">アーカイブ: 新しい順</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <Table>
                <TableHeader className="bg-slate-50">
                    <TableRow>
                        <TableHead className="w-16 text-center">画像</TableHead>
                        <TableHead>情報</TableHead>
                        <TableHead className="w-24 text-center">タイプ</TableHead>
                        <TableHead className="w-24 text-center">大きさ / 速度</TableHead>
                        <TableHead className="w-32 text-center">ステータス</TableHead>
                        <TableHead className="w-44">時刻</TableHead>
                        <TableHead className="text-right w-16">操作</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {sortedFish.map(fish => (
                        <FishRow
                            key={fish.id}
                            fish={fish}
                            onEdit={() => onEdit(fish)}
                            onDuplicate={onDuplicate}
                            onDelete={onDelete}
                        />
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

function FishRow({
    fish,
    onEdit,
    onDuplicate,
    onDelete,
}: {
    fish: ActiveFish;
    onEdit: () => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
}) {
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
            <TableCell className="p-2 align-middle border-r border-slate-100 relative">
                <div className="w-12 h-12 bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center border border-slate-200 mx-auto">
                    <img src={fish.textureUrl} alt="fish" className="max-w-full max-h-full object-contain" />
                </div>
                {(fish.isArchived || fish.isAutoHidden) && <div className="absolute top-1 right-1 bg-slate-700 text-white text-[9px] px-1 rounded">非表示</div>}
                {fish.isPinned && <div className="absolute top-1 left-1 text-sky-500 text-[10px]">📌</div>}
            </TableCell>
            <TableCell className="align-middle border-r border-slate-100">
                <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-bold text-slate-700 truncate max-w-[160px]">{fish.author ?? "anonymous"}</span>
                    <span className="text-[10px] font-mono text-slate-400">{fish.id.slice(0, 12)}…</span>
                </div>
            </TableCell>
            <TableCell className="align-middle border-r border-slate-100 text-center">
                <span className="text-[11px] font-bold bg-sky-50 text-sky-700 px-2 py-0.5 rounded-full border border-sky-100">
                    {typeLabel[fish.type] ?? fish.type}
                </span>
            </TableCell>
            <TableCell className="align-middle border-r border-slate-100 text-center">
                <div className="flex flex-col text-[11px] font-mono gap-0.5">
                    <span className="text-slate-600">×<span className="text-sky-600 font-bold">{fish.userParams.scale.toFixed(2)}</span></span>
                    <span className="text-slate-600">⚡<span className="text-emerald-600 font-bold">{fish.userParams.speed.toFixed(2)}</span></span>
                </div>
            </TableCell>
            <TableCell className="align-middle border-r border-slate-100 text-center">
                <div className="flex flex-col gap-0.5 items-center">
                    <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold text-white shadow-sm"
                        style={{ background: getLayerColor((fish.isArchived || fish.isAutoHidden) ? -1 : fish.layerIndex, 5) }}
                    >
                        {getLayerLabel(fish.layerIndex, fish.isArchived || fish.isAutoHidden)}
                    </span>
                    {fish.isAutoHidden && !fish.isArchived && <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">定員超過</span>}
                    {fish.isPinned && !fish.isArchived && <span className="text-[10px] bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded-full">固定</span>}
                </div>
            </TableCell>
            <TableCell className="align-middle border-r border-slate-100 text-[10px] text-slate-500">
                <div>作成 {formatTime(fish.createdAt)}</div><div>放流 {formatTime(fish.releasedAt)}</div>{fish.archivedAt && <div>保管 {formatTime(fish.archivedAt)}</div>}
            </TableCell>
            <TableCell className="text-right align-middle" onClick={event => event.stopPropagation()}>
                {pendingDelete ? (
                    <div className="flex justify-end items-center gap-1">
                        <span className="text-[10px] text-red-600 font-bold">?</span>
                        <Button variant="ghost" size="sm" className="h-7 px-1.5 text-[10px] text-slate-500 hover:bg-slate-100" onClick={() => setPendingDelete(false)}>戻る</Button>
                        <Button size="sm" className="h-7 px-1.5 text-[10px] bg-red-500 hover:bg-red-600 text-white" onClick={() => { onDelete(fish.id); setPendingDelete(false); }}>削除</Button>
                    </div>
                ) : (
                    <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" className="text-sky-500 hover:text-sky-700 hover:bg-sky-50 h-8 w-8 p-0" onClick={onEdit} title="設定"><Settings2 className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="sm" className="text-stone-500 hover:text-stone-700 hover:bg-stone-100 h-8 w-8 p-0" onClick={() => onDuplicate(fish.id)} title="複製"><CopyPlus className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600 hover:bg-red-50 h-8 w-8 p-0" onClick={() => setPendingDelete(true)} title="削除"><Trash2 className="w-4 h-4" /></Button>
                    </div>
                )}
            </TableCell>
        </TableRow>
    );
}

function formatTime(value: number): string {
    return new Date(value).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
