import { useState } from "react";
import { AlertTriangle, Fish, Gauge, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { PageHeader } from "./PageHeader";

export function SettingsPage({
    sendRateSetting,
    setSendRateSetting,
    onAddDemoFish,
    onRemoveAllFish,
    onReloadImages,
    startedAt,
}: {
    sendRateSetting: number;
    setSendRateSetting: (value: number) => void;
    onAddDemoFish: () => void;
    onRemoveAllFish: () => Promise<void>;
    onReloadImages: () => Promise<void>;
    startedAt: number;
}) {
    const [confirmDelete, setConfirmDelete] = useState(false);
    return (
        <div className="flex-1 overflow-y-auto bg-slate-50 p-8">
            <div className="mx-auto flex max-w-4xl flex-col gap-7">
                <PageHeader title="設定" description="通常運用では変更しない項目を調整します。" />
                <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h2 className="font-bold text-slate-900">システム稼働時間</h2>
                    <p className="mt-2 font-mono text-2xl font-bold text-sky-700">{formatUptime(Date.now() - startedAt)}</p>
                    <p className="mt-1 text-xs text-slate-500">サーバー起動: {new Date(startedAt).toLocaleString("ja-JP")}</p>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex items-start gap-3">
                        <div className="rounded-lg bg-sky-100 p-2"><Gauge className="h-5 w-5 text-sky-700" /></div>
                        <div className="flex-1">
                            <h2 className="font-bold text-slate-900">プレビュー送信間隔</h2>
                            <p className="mt-1 text-xs text-slate-500">レイアウト編集中にモニターへ送る更新頻度です。</p>
                            <div className="mt-5 flex items-center gap-5">
                                <Slider value={[sendRateSetting]} min={16} max={200} step={1} onValueChange={value => setSendRateSetting(value[0])} />
                                <span className="w-20 rounded-md bg-slate-100 px-3 py-2 text-center font-mono text-sm font-bold text-slate-700">{sendRateSetting}ms</span>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex items-start justify-between gap-6">
                        <div>
                            <h2 className="font-bold text-slate-900">モニター画像の再読み込み</h2>
                            <p className="mt-1 text-xs text-slate-500">モニターに表示中の魚と背景画像を読み込み直します。</p>
                        </div>
                        <Button variant="outline" onClick={() => void onReloadImages()}><RefreshCw className="mr-2 h-4 w-4" />再読み込み</Button>
                    </div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex items-start justify-between gap-6">
                        <div className="flex items-start gap-3">
                            <div className="rounded-lg bg-emerald-100 p-2"><Fish className="h-5 w-5 text-emerald-700" /></div>
                            <div>
                                <h2 className="font-bold text-slate-900">動作確認用の魚</h2>
                                <p className="mt-1 text-xs text-slate-500">水槽の表示と動きを確認する魚を1匹追加します。</p>
                            </div>
                        </div>
                        <Button variant="outline" onClick={onAddDemoFish}>魚を追加</Button>
                    </div>
                </section>

                <section className="rounded-xl border border-rose-200 bg-rose-50 p-6">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-5 w-5 text-rose-600" />
                        <div className="flex-1">
                            <h2 className="font-bold text-rose-900">危険な操作</h2>
                            <p className="mt-1 text-xs text-rose-700">全ての魚を水槽から削除します。この操作は取り消せません。</p>
                            <div className="mt-5">
                                {confirmDelete ? (
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-bold text-rose-800">全ての魚を削除しますか？</span>
                                        <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>キャンセル</Button>
                                        <Button variant="destructive" size="sm" onClick={() => void onRemoveAllFish()}>全て削除</Button>
                                    </div>
                                ) : (
                                    <Button variant="destructive" onClick={() => setConfirmDelete(true)}>全ての魚を削除</Button>
                                )}
                            </div>
                        </div>
                    </div>
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
