import type { DisplayClientInfo, TestPattern } from "@aquarium/shared";
import { Monitor, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "./PageHeader";

export function ClientsPage({
    displays,
    onTestPattern,
    onOpenLayout,
}: {
    displays: DisplayClientInfo[];
    onTestPattern: (pattern: TestPattern, uuid?: string) => Promise<void>;
    onOpenLayout: () => void;
}) {
    const ordered = [...displays].sort((a, b) => Number(Boolean(b.disconnectedAt)) - Number(Boolean(a.disconnectedAt)));
    return (
        <div className="flex-1 overflow-y-auto bg-slate-50 p-8">
            <div className="mx-auto flex max-w-7xl flex-col gap-6">
                <PageHeader title="表示端末" description="接続状態と表示範囲を確認します。" actions={<Button variant="outline" onClick={onOpenLayout}>表示範囲を調整</Button>} />
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="grid grid-cols-[1fr_140px_180px_180px] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-bold text-slate-500">
                        <span>端末</span><span>接続状態</span><span>画面解像度</span><span>表示範囲</span>
                    </div>
                    {ordered.map(display => (
                        <div key={display.uuid} className="grid grid-cols-[1fr_140px_180px_180px] items-center gap-4 border-b border-slate-100 px-5 py-4 last:border-b-0">
                            <div className="flex min-w-0 items-center gap-3">
                                <div className="rounded-lg bg-slate-100 p-2"><Monitor className="h-4 w-4 text-slate-600" /></div>
                                <div className="min-w-0">
                                    <div className="truncate font-mono text-sm font-semibold text-slate-800">{display.uuid}</div>
                                    <button className="mt-1 text-xs font-medium text-sky-600 hover:text-sky-700" onClick={() => void onTestPattern("identify", display.uuid)}>端末を識別</button>
                                </div>
                            </div>
                            <div className={`flex items-center gap-2 text-xs font-bold ${display.disconnectedAt ? "text-rose-600" : "text-emerald-600"}`}>
                                {display.disconnectedAt ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
                                {display.disconnectedAt ? "切断中" : display.ping !== undefined ? `${Math.max(0, display.ping)}ms` : "接続中"}
                            </div>
                            <div className="font-mono text-sm text-slate-600">{display.screenW} × {display.screenH}</div>
                            <div className="font-mono text-sm text-slate-600">{display.viewport ? `${Math.round(display.viewport.width)} × ${Math.round(display.viewport.height)}` : "未設定"}</div>
                        </div>
                    ))}
                    {ordered.length === 0 && <div className="p-12 text-center text-sm text-slate-500">接続されている表示端末はありません。</div>}
                </div>
            </div>
        </div>
    );
}
