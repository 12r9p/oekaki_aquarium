import type { ActiveFish, DisplayClientInfo, PendingFish } from "@aquarium/shared";
import { AlertTriangle, CheckCircle2, Fish, ImageIcon, Maximize2, Monitor, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "./PageHeader";
import type { ManagePage } from "./Toolbar";

function StatusCard({
    label,
    value,
    detail,
    icon,
    tone = "slate",
}: {
    label: string;
    value: string | number;
    detail: string;
    icon: React.ReactNode;
    tone?: "slate" | "sky" | "emerald" | "amber";
}) {
    const tones = {
        slate: "bg-slate-100 text-slate-600",
        sky: "bg-sky-100 text-sky-700",
        emerald: "bg-emerald-100 text-emerald-700",
        amber: "bg-amber-100 text-amber-700",
    };
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="text-sm font-medium text-slate-500">{label}</div>
                    <div className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{value}</div>
                </div>
                <div className={`rounded-lg p-2.5 ${tones[tone]}`}>{icon}</div>
            </div>
            <div className="mt-4 text-xs text-slate-500">{detail}</div>
        </div>
    );
}

export function DashboardPage({
    connected,
    displays,
    activeFish,
    pendingFish,
    worldW,
    worldH,
    bgUrl,
    sendRateSetting,
    onNavigate,
}: {
    connected: boolean;
    displays: DisplayClientInfo[];
    activeFish: ActiveFish[];
    pendingFish: PendingFish[];
    worldW: number;
    worldH: number;
    bgUrl: string;
    sendRateSetting: number;
    onNavigate: (page: ManagePage) => void;
}) {
    const disconnectedDisplays = displays.filter(display => display.disconnectedAt).length;
    const hasAttention = !connected || disconnectedDisplays > 0 || pendingFish.length > 0;

    return (
        <div className="flex-1 overflow-y-auto bg-slate-50 p-8">
            <div className="mx-auto flex max-w-7xl flex-col gap-7">
                <PageHeader title="ステータス" description="接続状況と対応が必要な項目を確認します。" />

                <section className={`flex items-center justify-between gap-6 rounded-xl border p-4 ${hasAttention ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
                    <div className="flex items-center gap-3">
                        {hasAttention ? <AlertTriangle className="h-5 w-5 text-amber-600" /> : <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
                        <div>
                            <div className={`text-sm font-bold ${hasAttention ? "text-amber-900" : "text-emerald-900"}`}>
                                {hasAttention ? "確認が必要な項目があります" : "水槽は稼働中です"}
                            </div>
                            <div className={`mt-0.5 text-xs ${hasAttention ? "text-amber-700" : "text-emerald-700"}`}>
                                {!connected ? "サーバーとの接続を確認してください。" : pendingFish.length > 0 ? `${pendingFish.length}匹が承認待ちです。` : disconnectedDisplays > 0 ? `${disconnectedDisplays}台の端末が切断されています。` : "接続中の端末に水槽を表示しています。"}
                            </div>
                        </div>
                    </div>
                    {pendingFish.length > 0 && <Button size="sm" onClick={() => onNavigate("pending")}>承認待ちを確認</Button>}
                </section>

                <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                    <StatusCard label="接続中の表示端末" value={displays.length - disconnectedDisplays} detail={`${displays.length}台を登録中`} icon={<Monitor className="h-5 w-5" />} tone="sky" />
                    <StatusCard label="表示中の魚" value={activeFish.filter(fish => !fish.isArchived).length} detail={`${activeFish.filter(fish => fish.isArchived).length}匹を非表示`} icon={<Fish className="h-5 w-5" />} tone="emerald" />
                    <StatusCard label="承認待ち" value={pendingFish.length} detail={pendingFish.length > 0 ? "内容を確認して処理してください" : "未処理の魚はありません"} icon={<Send className="h-5 w-5" />} tone={pendingFish.length > 0 ? "amber" : "slate"} />
                    <StatusCard label="送信間隔" value={`${sendRateSetting}ms`} detail={`約 ${Math.round(1000 / sendRateSetting)} fps`} icon={<Maximize2 className="h-5 w-5" />} />
                </section>

                <section className="grid gap-5 lg:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                        <h2 className="text-base font-bold text-slate-900">水槽</h2>
                        <div className="mt-5 grid grid-cols-2 gap-4">
                            <div className="rounded-lg bg-slate-50 p-4">
                                <div className="text-xs font-medium text-slate-500">表示範囲</div>
                                <div className="mt-1 font-mono text-lg font-bold text-slate-800">{worldW} × {worldH}</div>
                            </div>
                            <div className="rounded-lg bg-slate-50 p-4">
                                <div className="text-xs font-medium text-slate-500">背景画像</div>
                                <div className="mt-1 flex items-center gap-2 text-sm font-bold text-slate-800">
                                    <ImageIcon className="h-4 w-4 text-slate-500" />
                                    {bgUrl ? "設定済み" : "未設定"}
                                </div>
                            </div>
                        </div>
                        <Button variant="outline" className="mt-5" onClick={() => onNavigate("layout")}>水槽レイアウトを開く</Button>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                        <h2 className="text-base font-bold text-slate-900">次の確認</h2>
                        <div className="mt-4 flex flex-col divide-y divide-slate-100">
                            <button className="flex items-center justify-between py-3 text-left text-sm hover:text-sky-700" onClick={() => onNavigate("pending")}>
                                <span>承認待ちの魚</span><span className="font-bold">{pendingFish.length}匹</span>
                            </button>
                            <button className="flex items-center justify-between py-3 text-left text-sm hover:text-sky-700" onClick={() => onNavigate("clients")}>
                                <span>切断中の表示端末</span><span className="font-bold">{disconnectedDisplays}台</span>
                            </button>
                            <button className="flex items-center justify-between py-3 text-left text-sm hover:text-sky-700" onClick={() => onNavigate("fish")}>
                                <span>非表示の魚</span><span className="font-bold">{activeFish.filter(fish => fish.isArchived).length}匹</span>
                            </button>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
