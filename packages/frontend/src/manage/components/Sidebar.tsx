import React from "react";
import type { DisplayClientInfo, TestPattern } from "@aquarium/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { Settings, List, Plus, LayoutGrid, Palette, LocateFixed, MonitorOff, Map as MapIcon, KeySquare, Target } from "lucide-react";

interface SidebarProps {
    displays: DisplayClientInfo[];
    selectedDisplayIds: string[];
    onTestPattern: (pattern: TestPattern, uuid?: string) => Promise<void>;
    worldW: number;
    worldH: number;
    onAddDemoFish: () => void;
    onSaveViewport: (uuid: string, vp: NonNullable<DisplayClientInfo["viewport"]>) => Promise<void>;
    sendRateSetting: number;
    setSendRateSetting: (rate: number) => void;
    onUpdateWorldSize: (w: number, h: number) => void;
    bgUrl: string;
    onUpdateBgUrl: (url: string) => void;
    forbiddenZones: { id: string; x: number; y: number; width: number; height: number }[];
    onUpdateForbiddenZones: (zones: { id: string; x: number; y: number; width: number; height: number }[]) => void;
}

export function Sidebar({
    displays, selectedDisplayIds, onTestPattern, worldW, worldH, onAddDemoFish, onSaveViewport,
    sendRateSetting, setSendRateSetting, onUpdateWorldSize, bgUrl, onUpdateBgUrl, forbiddenZones, onUpdateForbiddenZones
}: SidebarProps): React.ReactElement {

    // UUIDの略称表示
    const shortId = (id: string) => {
        const parts = id.split("-");
        return parts.length > 2 ? `${parts[0]}-${parts[1]}...${parts[parts.length - 1].slice(-4)}` : id.slice(0, 12);
    };

    return (
        <aside className="w-[340px] flex-shrink-0 flex flex-col bg-white border-l border-slate-200 overflow-y-auto">
            <Tabs defaultValue="list" className="w-full h-full flex flex-col">
                <TabsList className="w-full flex h-12 rounded-none border-b border-slate-200 bg-slate-50 p-0">
                    <TabsTrigger value="list" className="flex-1 rounded-none data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-sky-500 data-[state=active]:shadow-none data-[state=active]:text-sky-600 focus-visible:ring-0">
                        <List className="w-4 h-4 mr-2" />
                        一覧 ({displays.length})
                    </TabsTrigger>
                    <TabsTrigger value="props" className="flex-1 rounded-none data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-sky-500 data-[state=active]:shadow-none data-[state=active]:text-sky-600 focus-visible:ring-0">
                        <Settings className="w-4 h-4 mr-2" />
                        プロパティ
                    </TabsTrigger>
                </TabsList>

                {/* --- 一覧 タブ --- */}
                <TabsContent value="list" className="flex-1 overflow-y-auto p-4 m-0 data-[state=inactive]:hidden">
                    <Accordion type="multiple" defaultValue={displays.map(d => d.uuid)} className="w-full flex flex-col gap-3">
                        {displays.map(d => {
                            const isSelected = selectedDisplayIds.includes(d.uuid);
                            const vp = d.viewport;
                            const isConfigured = !!vp;

                            return (
                                <AccordionItem
                                    key={d.uuid}
                                    value={d.uuid}
                                    className={`border border-slate-200 rounded-lg overflow-hidden transition-all shadow-sm ${isSelected ? 'ring-2 ring-sky-500 ring-offset-1' : 'hover:border-slate-300'}`}
                                >
                                    <AccordionTrigger className={`px-4 py-3 hover:no-underline hover:bg-slate-50 ${isSelected ? 'bg-sky-50/50' : 'bg-white'}`}>
                                        <div className="flex flex-col items-start gap-1 w-full text-left">
                                            <div className="flex items-center gap-2 font-mono text-xs text-slate-700 font-semibold w-full pr-4 truncate">
                                                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isConfigured ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]' : 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]'}`} />
                                                {shortId(d.uuid)}
                                            </div>
                                            {vp && (
                                                <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-0.5 ml-4 font-mono">
                                                    <span>{Math.round(vp.x)},{Math.round(vp.y)}</span>
                                                    <span>| {Math.round(vp.width)}×{Math.round(vp.height)}</span>
                                                    <span className="text-sky-600">x{vp.scale.toFixed(2)}</span>
                                                </div>
                                            )}
                                        </div>
                                    </AccordionTrigger>

                                    <AccordionContent className="bg-slate-50 border-t border-slate-100 p-4 pb-4">
                                        <div className="flex flex-col gap-4">
                                            {/* Hardware Info */}
                                            <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 bg-white p-2.5 rounded border border-slate-200 shadow-sm">
                                                <div className="flex flex-col">
                                                    <span className="font-semibold text-slate-400 mb-0.5 uppercase tracking-wide text-[10px]">Hardware res</span>
                                                    <span className="font-mono">{d.screenW}×{d.screenH}</span>
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="font-semibold text-slate-400 mb-0.5 uppercase tracking-wide text-[10px]">Ping</span>
                                                    <span className="font-mono text-emerald-600 flex items-center gap-1">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> &lt;1ms
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Individual Pattern Control */}
                                            <div>
                                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Test Pattern</div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <Button variant={d.testPattern === "worldmap" ? "default" : "outline"} size="sm" onClick={() => onTestPattern("worldmap", d.uuid)} className="h-8 text-xs font-semibold justify-start"><MapIcon className="w-3.5 h-3.5 mr-2" /> WorldMap</Button>
                                                    <Button variant={d.testPattern === "calibration" ? "default" : "outline"} size="sm" onClick={() => onTestPattern("calibration", d.uuid)} className="h-8 text-xs font-semibold justify-start"><Target className="w-3.5 h-3.5 mr-2" /> Calibration</Button>
                                                    <Button variant={d.testPattern === "colorbars" ? "default" : "outline"} size="sm" onClick={() => onTestPattern("colorbars", d.uuid)} className="h-8 text-xs font-semibold justify-start"><Palette className="w-3.5 h-3.5 mr-2" /> Colorbars</Button>
                                                    <Button variant={d.testPattern === "grid" ? "default" : "outline"} size="sm" onClick={() => onTestPattern("grid", d.uuid)} className="h-8 text-xs font-semibold justify-start"><LayoutGrid className="w-3.5 h-3.5 mr-2" /> Grid</Button>
                                                    <Button variant={d.testPattern === "off" ? "secondary" : "outline"} size="sm" onClick={() => onTestPattern("off", d.uuid)} className="h-8 text-xs font-semibold justify-start col-span-2 text-slate-600"><MonitorOff className="w-3.5 h-3.5 mr-2" /> Off (Draw Mode)</Button>
                                                </div>
                                            </div>
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                            )
                        })}

                        {displays.length === 0 && (
                            <div className="text-center p-8 text-sm text-slate-400 border-2 border-dashed border-slate-200 rounded-lg">
                                接続されている<br />ディスプレイはありません
                            </div>
                        )}
                    </Accordion>
                </TabsContent>

                {/* --- プロパティ タブ --- */}
                <TabsContent value="props" className="flex-1 overflow-y-auto p-5 m-0 data-[state=inactive]:hidden flex flex-col gap-6">

                    {/* World Area Settings */}
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                            <KeySquare className="w-4 h-4 text-sky-500" />
                            <h3 className="text-sm font-bold text-slate-800">キャンバス全体設定 (World)</h3>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="world-width" className="text-xs text-slate-500">World Width</Label>
                                <Input id="world-width" type="number" min={100} value={worldW} onChange={e => onUpdateWorldSize(Number(e.target.value) || 100, worldH)} className="font-mono bg-white text-slate-800 h-8 focus:ring-1 focus:ring-sky-500" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="world-height" className="text-xs text-slate-500">World Height</Label>
                                <Input id="world-height" type="number" min={100} value={worldH} onChange={e => onUpdateWorldSize(worldW, Number(e.target.value) || 100)} className="font-mono bg-white text-slate-800 h-8 focus:ring-1 focus:ring-sky-500" />
                            </div>
                        </div>
                        <div className="flex flex-col gap-1.5 mt-2">
                            <Label htmlFor="bg-url" className="text-xs text-slate-500">背景画像 URL (任意)</Label>
                            <Input id="bg-url" type="text" placeholder="https://..." value={bgUrl} onChange={e => onUpdateBgUrl(e.target.value)} className="font-mono bg-white text-slate-800 h-8 focus:ring-1 focus:ring-sky-500" />
                            <p className="text-[10px] text-slate-400">水槽全体の最背面に表示する画像</p>
                        </div>
                    </div>

                    {/* Sync Rate Setting */}
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                            <Settings className="w-4 h-4 text-emerald-500" />
                            <h3 className="text-sm font-bold text-slate-800">通信設定 (Sync Rate)</h3>
                        </div>
                        <div className="flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs text-slate-500">Update Interval</Label>
                                <span className="font-mono text-xs text-slate-600 font-semibold bg-slate-100 px-2 py-0.5 rounded">{sendRateSetting}ms</span>
                            </div>
                            <Slider
                                value={[sendRateSetting]}
                                onValueChange={val => setSendRateSetting(val[0])}
                                min={16} max={500} step={1}
                                className="w-full"
                            />
                            <p className="text-[10px] text-slate-400 tracking-tight">ドラッグ時やホバー時のバックエンドへの送信間隔を調整します。小さいほど滑らかになりますが負荷が上がります。</p>
                        </div>
                    </div>

                    {/* Viewport Transform (Targeting Selected Display) */}
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                            <LocateFixed className="w-4 h-4 text-violet-500" />
                            <h3 className="text-sm font-bold text-slate-800">Viewport (選択中ディスプレイ)</h3>
                        </div>

                        {selectedDisplayIds.length > 0 ? (
                            displays.filter(d => selectedDisplayIds.includes(d.uuid)).map(d => {
                                const vp = d.viewport;
                                if (!vp) return (
                                    <div key={d.uuid} className="text-sm text-amber-600 bg-amber-50 p-3 rounded border border-amber-200">
                                        Viewportが未設定です。左の画面でドラッグして初期化してください。
                                    </div>
                                );
                                return (
                                    <div key={d.uuid} className="grid grid-cols-2 gap-3">
                                        <div className="flex flex-col gap-1.5">
                                            <Label className="text-xs text-slate-500">X (Left)</Label>
                                            <Input type="number" value={Math.round(vp.x)} onChange={(e) => onSaveViewport(d.uuid, { ...vp, x: Number(e.target.value) })} className="font-mono h-8" />
                                        </div>
                                        <div className="flex flex-col gap-1.5">
                                            <Label className="text-xs text-slate-500">Y (Top)</Label>
                                            <Input type="number" value={Math.round(vp.y)} onChange={(e) => onSaveViewport(d.uuid, { ...vp, y: Number(e.target.value) })} className="font-mono h-8" />
                                        </div>
                                        <div className="flex flex-col gap-1.5">
                                            <Label className="text-xs text-slate-500">Width</Label>
                                            <Input type="number" value={Math.round(vp.width)} onChange={(e) => onSaveViewport(d.uuid, { ...vp, width: Number(e.target.value) })} className="font-mono h-8" />
                                        </div>
                                        <div className="flex flex-col gap-1.5">
                                            <Label className="text-xs text-slate-500">Height</Label>
                                            <Input type="number" value={Math.round(vp.height)} onChange={(e) => onSaveViewport(d.uuid, { ...vp, height: Number(e.target.value) })} className="font-mono h-8" />
                                        </div>
                                        <div className="flex flex-col gap-1.5 col-span-2">
                                            <Label className="text-xs text-slate-500">Scale (Render Resolution)</Label>
                                            <Input type="number" step="0.01" value={vp.scale.toFixed(2)} onChange={(e) => onSaveViewport(d.uuid, { ...vp, scale: Number(e.target.value) })} className="font-mono h-8 bg-slate-50 text-sky-700 font-semibold" />
                                            <p className="text-[10px] text-slate-400 tracking-tight">値が大きいほどディスプレイ側で高解像度でレンダリングされます。</p>
                                        </div>
                                    </div>
                                )
                            })
                        ) : (
                            <div className="text-sm text-slate-400 p-4 border border-slate-100 bg-slate-50 rounded text-center">
                                キャンバス上で<br />ディスプレイを選択してください
                            </div>
                        )}
                    </div>

                    {/* Global Actions */}
                    <div className="flex flex-col gap-3 mt-auto pt-4 border-t border-slate-100">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">グローバル テストパターン表示</h3>
                        <div className="grid grid-cols-2 gap-2">
                            <Button variant="outline" size="sm" onClick={() => onTestPattern("worldmap")} className="h-8 text-xs font-semibold justify-start"><MapIcon className="w-3.5 h-3.5 mr-2" /> All WorldMap</Button>
                            <Button variant="outline" size="sm" onClick={() => onTestPattern("calibration")} className="h-8 text-xs font-semibold justify-start"><Target className="w-3.5 h-3.5 mr-2" /> All Calibrate</Button>
                            <Button variant="secondary" size="sm" onClick={() => onTestPattern("off")} className="h-8 text-xs font-semibold justify-center col-span-2 text-slate-600"><MonitorOff className="w-3.5 h-3.5 mr-2" /> All Off</Button>
                        </div>
                    </div>

                </TabsContent>
            </Tabs>
        </aside>
    );
}

