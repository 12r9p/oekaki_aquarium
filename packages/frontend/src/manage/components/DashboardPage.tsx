import type { ActiveFish, DisplayClientInfo, LayerConfig, PendingFish, SystemMetrics } from "@aquarium/shared";
import { AlertTriangle, CheckCircle2, ExternalLink, Fish, ImageIcon, Maximize2, Monitor, Send, Cpu, Activity, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "./PageHeader";
import type { ManagePage } from "./Toolbar";
import { LayerOccupancySection } from "./fish/LayerOccupancySection";
import { SystemMetricsChart } from "./SystemMetricsChart";

function StatusCard({
    label,
    value,
    detail,
    icon,
    tone = "slate",
    onClick,
    progress,
    progressColor = "bg-sky-500",
}: {
    label: string;
    value: string | number;
    detail: string;
    icon: React.ReactNode;
    tone?: "slate" | "sky" | "emerald" | "amber";
    onClick?: () => void;
    progress?: number;
    progressColor?: string;
}) {
    const tones = {
        slate: "bg-slate-100 text-slate-600",
        sky: "bg-sky-100 text-sky-700",
        emerald: "bg-emerald-100 text-emerald-700",
        amber: "bg-amber-100 text-amber-700",
    };

    const content = (
        <>
            <div className="w-full">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="text-sm font-medium text-slate-500">{label}</div>
                        <div className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{value}</div>
                    </div>
                    <div className={`rounded-lg p-2.5 ${tones[tone]}`}>{icon}</div>
                </div>
                {progress !== undefined && (
                    <div className="mt-3.5 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div className={`h-full ${progressColor} transition-all duration-500`} style={{ width: `${progress}%` }} />
                    </div>
                )}
            </div>
            <div className="mt-4 flex w-full items-center justify-between text-xs text-slate-500">
                <span>{detail}</span>
                {onClick && <ExternalLink className="h-3.5 w-3.5" />}
            </div>
        </>
    );

    const baseClass = "rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm flex flex-col justify-between";

    if (onClick) {
        return (
            <button
                type="button"
                onClick={onClick}
                className={`${baseClass} transition hover:border-sky-300 hover:shadow w-full`}
            >
                {content}
            </button>
        );
    }

    return (
        <div className={baseClass}>
            {content}
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
    fishLayers,
    systemMetrics,
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
    fishLayers: LayerConfig[];
    systemMetrics: SystemMetrics;
    onNavigate: (page: ManagePage) => void;
}) {
    const disconnectedDisplays = displays.filter(display => display.disconnectedAt).length;
    const hasAttention = !connected || disconnectedDisplays > 0 || pendingFish.length > 0;

    // --- サーバー負荷 & ディスプレイ負荷の計算 (直近10サンプルの平均) ---
    const samples = systemMetrics?.samples || [];
    const recentSamples = samples.slice(-10);
    const avgCalcMs = recentSamples.length > 0
        ? recentSamples.reduce((sum, s) => sum + s.fishCalculationMs, 0) / recentSamples.length
        : 0;
    // 60fps (16.67ms) に対する負荷率（100%超を許容）
    const serverLoadPercent = Math.round((avgCalcMs / 16.67) * 100);

    const avgCommMs = recentSamples.length > 0
        ? recentSamples.reduce((sum, s) => sum + s.monitorCommunicationMs, 0) / recentSamples.length
        : 0;
    const displayDelayText = avgCommMs === 0 ? "通信なし" : avgCommMs < 15 ? "通信遅延: 非常に良好" : avgCommMs < 40 ? "通信遅延: 良好" : "通信遅延: 警告";

    // --- メモリ使用量の計算 (直近10サンプルの平均) ---
    const avgRssBytes = recentSamples.length > 0
        ? recentSamples.reduce((sum, s) => sum + (s.memoryRss || 0), 0) / recentSamples.length
        : 0;
    const avgHeapBytes = recentSamples.length > 0
        ? recentSamples.reduce((sum, s) => sum + (s.memoryHeapUsed || 0), 0) / recentSamples.length
        : 0;
    const memoryRssMb = avgRssBytes / (1024 * 1024);
    const memoryHeapMb = avgHeapBytes / (1024 * 1024);

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

                <section className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
                    <StatusCard onClick={() => onNavigate("layout")} label="接続中のモニター" value={displays.length - disconnectedDisplays} detail={`${displays.length}台を登録中`} icon={<Monitor className="h-5 w-5" />} tone="sky" />
                    <StatusCard onClick={() => onNavigate("fish")} label="表示中の魚" value={activeFish.filter(fish => !fish.isArchived).length} detail={`${activeFish.filter(fish => fish.isArchived).length}匹を非表示`} icon={<Fish className="h-5 w-5" />} tone="emerald" />
                    <StatusCard onClick={() => onNavigate("pending")} label="承認待ち" value={pendingFish.length} detail={pendingFish.length > 0 ? "内容を確認して処理してください" : "未処理の魚はありません"} icon={<Send className="h-5 w-5" />} tone={pendingFish.length > 0 ? "amber" : "slate"} />
                    <StatusCard label="送信間隔" value={`${sendRateSetting}ms`} detail={`約 ${Math.round(1000 / sendRateSetting)} fps`} icon={<Maximize2 className="h-5 w-5" />} />
                    <StatusCard
                        label="サーバー負荷"
                        value={`${serverLoadPercent}%`}
                        detail={`演算時間: ${avgCalcMs.toFixed(1)}ms`}
                        icon={<Cpu className="h-5 w-5" />}
                        tone={serverLoadPercent > 70 ? "amber" : "slate"}
                        progress={Math.min(100, serverLoadPercent)}
                        progressColor={serverLoadPercent > 75 ? "bg-rose-500" : serverLoadPercent > 45 ? "bg-amber-500" : "bg-violet-500"}
                    />
                    <StatusCard
                        label="ディスプレイ負荷"
                        value={avgCommMs > 0 ? `${Math.round(avgCommMs)}ms` : "-- ms"}
                        detail={displayDelayText}
                        icon={<Activity className="h-5 w-5" />}
                        tone={avgCommMs > 40 ? "amber" : "slate"}
                        progress={avgCommMs > 0 ? Math.min(100, (avgCommMs / 60) * 100) : undefined}
                        progressColor={avgCommMs > 40 ? "bg-rose-500" : avgCommMs > 20 ? "bg-amber-500" : "bg-sky-500"}
                    />
                    <StatusCard
                        label="メモリ使用量"
                        value={avgRssBytes > 0 ? `${Math.round(memoryRssMb)} MB` : "-- MB"}
                        detail={`ヒープ使用: ${Math.round(memoryHeapMb)} MB`}
                        icon={<HardDrive className="h-5 w-5" />}
                        tone={memoryRssMb > 400 ? "amber" : "slate"}
                        progress={avgRssBytes > 0 ? Math.min(100, (memoryRssMb / 512) * 100) : undefined}
                        progressColor={memoryRssMb > 400 ? "bg-rose-500" : memoryRssMb > 250 ? "bg-amber-500" : "bg-emerald-500"}
                    />
                </section>
                <SystemMetricsChart samples={systemMetrics.samples} />

                <section className="grid gap-5 lg:grid-cols-3">
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between">
                        <div>
                            <h2 className="text-base font-bold text-slate-900">水槽とシステム</h2>
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
                                <div className="rounded-lg bg-slate-50 p-4 col-span-2">
                                    <div className="text-xs font-medium text-slate-500">システム稼働時間</div>
                                    <div className="mt-1 font-mono text-lg font-bold text-sky-700">{formatUptime(Date.now() - systemMetrics.startedAt)}</div>
                                    <div className="mt-0.5 text-[10px] text-slate-400">起動: {new Date(systemMetrics.startedAt).toLocaleString("ja-JP")}</div>
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
                            <button className="flex items-center justify-between py-3 text-left text-sm hover:text-sky-700" onClick={() => onNavigate("layout")}>
                                <span>切断中のモニター</span><span className="font-bold">{disconnectedDisplays}台</span>
                            </button>
                            <button className="flex items-center justify-between py-3 text-left text-sm hover:text-sky-700" onClick={() => onNavigate("fish")}>
                                <span>非表示の魚</span><span className="font-bold">{activeFish.filter(fish => fish.isArchived).length}匹</span>
                            </button>
                        </div>
                    </div>
                    <LayerOccupancySection activeFish={activeFish} configs={fishLayers} compact />
                </section>
            </div>
        </div>
    );
}

function formatUptime(ms: number): string {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor(seconds / 3600) % 24;
    const minutes = Math.floor(seconds / 60) % 60;
    return `${days}日 ${hours}時間 ${minutes}分`;
}
