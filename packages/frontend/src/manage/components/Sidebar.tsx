import React from "react";
import type { WsServerMessage, DisplayClientInfo, TestPattern, ActiveFish, PendingFish, AppLayerConfig, HorizontalBoundaryMode } from "@aquarium/shared";
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
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Monitor, MonitorPlay, Settings, Layers, Trash2, Eye, EyeOff, PlusCircle,
    ImageIcon, KeySquare, Upload, HelpCircle, Ban, Sparkles, AlertTriangle, Play, ChevronUp, ChevronDown, CheckCircle2,
    LayoutTemplate, MonitorSmartphone, LocateFixed, Map as MapIcon, Target, Palette, LayoutGrid, MonitorOff, List, Copy, ExternalLink, WifiOff
} from "lucide-react";

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
    spawnPoints: { id: string; x: number; y: number }[];
    onUpdateSpawnPoints: (points: { id: string; x: number; y: number }[]) => void;
    layers: AppLayerConfig[];
    onUpdateLayers: (layers: AppLayerConfig[]) => void;
    horizontalBoundaryMode: HorizontalBoundaryMode;
    onUpdateHorizontalBoundaryMode: (mode: HorizontalBoundaryMode) => void;
    fishSpeedMultiplier: number;
    onUpdateFishSpeedMultiplier: (speed: number) => void;

    // 追加: 選択中レイヤーのIDとその更新関数
    activeLayerId?: string;
    onSetActiveLayerId?: (id: string | undefined) => void;
}

export function Sidebar({
    displays, selectedDisplayIds, onTestPattern, worldW, worldH, onAddDemoFish, onSaveViewport,
    sendRateSetting, setSendRateSetting, onUpdateWorldSize, bgUrl, onUpdateBgUrl, forbiddenZones, onUpdateForbiddenZones,
    spawnPoints, onUpdateSpawnPoints, layers, onUpdateLayers,
    horizontalBoundaryMode, onUpdateHorizontalBoundaryMode, fishSpeedMultiplier, onUpdateFishSpeedMultiplier,
    activeLayerId, onSetActiveLayerId
}: SidebarProps) {

    // UUIDの略称表示
    const shortId = (id: string) => {
        const parts = id.split("-");
        return parts.length > 2 ? `${parts[0]}-${parts[1]}...${parts[parts.length - 1].slice(-4)}` : id.slice(0, 12);
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, layerId: string) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            const dataUrl = ev.target?.result as string;
            if (!dataUrl) return;
            try {
                const res = await fetch("/api/upload-image", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ filename: file.name, data: dataUrl })
                });
                const data = await res.json();
                if (data.success && data.url) {
                    const img = new Image();
                    img.onload = () => {
                        const w = img.naturalWidth || 800;
                        const h = img.naturalHeight || 600;
                        onUpdateLayers(layers.map(l => l.id === layerId ? { ...l, url: data.url, name: file.name, x: 0, y: 0, width: w, height: h, aspectRatioLocked: true } : l));
                    };
                    img.src = dataUrl;
                }
            } catch (err) {
                console.error(err);
            }
        };
        reader.readAsDataURL(file);
    };

    return (
        <aside className="w-[340px] flex-shrink-0 flex flex-col bg-white border-l border-slate-200 overflow-y-auto">
            <Tabs defaultValue="list" className="w-full h-full flex flex-col">
                <TabsList className="w-full flex h-12 rounded-none border-b border-slate-200 bg-slate-50 p-0">
                    <TabsTrigger value="list" className="flex-1 rounded-none data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-sky-500 data-[state=active]:shadow-none data-[state=active]:text-sky-600 focus-visible:ring-0">
                        <List className="w-4 h-4 mr-2" />
                        一覧 ({displays.length})
                    </TabsTrigger>
                    <TabsTrigger value="layers" className="flex-1 rounded-none data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-sky-500 data-[state=active]:shadow-none data-[state=active]:text-sky-600 focus-visible:ring-0">
                        <Layers className="w-4 h-4 mr-2" />
                        レイヤー
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
                                    className={`border rounded-lg overflow-hidden transition-all shadow-sm ${d.disconnectedAt ? 'border-rose-300 bg-rose-50' : (isSelected ? 'border-emerald-500 ring-2 ring-emerald-500 ring-offset-1' : 'border-slate-200 hover:border-slate-300')}`}
                                >
                                    <AccordionTrigger className={`px-4 py-3 hover:no-underline ${d.disconnectedAt ? 'hover:bg-rose-100 bg-rose-50' : (isSelected ? 'bg-emerald-50/50' : 'bg-white hover:bg-slate-50')}`}>
                                        <div className="flex flex-col items-start gap-1 w-full text-left">
                                            <div className="flex items-center gap-2 font-mono text-xs text-slate-700 font-semibold w-full pr-4 truncate">
                                                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isConfigured ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]' : 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]'}`} />
                                                {shortId(d.uuid)}
                                            </div>
                                            {vp && (
                                                <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-0.5 ml-4 font-mono">
                                                    <span>{Math.round(vp.x)},{Math.round(vp.y)}</span>
                                                    <span>| {Math.round(vp.width)}×{Math.round(vp.height)}</span>
                                                    <span className="text-emerald-600">x{vp.scale.toFixed(2)}</span>
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
                                                    <span className="font-semibold text-slate-400 mb-0.5 uppercase tracking-wide text-[10px]">Ping / Status</span>
                                                    <span className={`font-mono flex items-center gap-1 ${d.disconnectedAt ? 'text-rose-500' : 'text-emerald-600'}`}>
                                                        <div className={`w-1.5 h-1.5 rounded-full ${d.disconnectedAt ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}`} />
                                                        {d.disconnectedAt ? "通信切断中" : (d.ping !== undefined ? `${Math.max(0, d.ping)}ms` : "<1ms")}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Viewport Editor */}
                                            {vp && (
                                                <div className="flex flex-col gap-2 p-2.5 rounded border border-slate-200 bg-white shadow-sm">
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Viewport Manual Edit</div>
                                                    <div className="grid grid-cols-4 gap-2">
                                                        <div className="flex flex-col gap-1">
                                                            <span className="text-[9px] text-slate-500">X</span>
                                                            <Input type="number" value={Math.round(vp.x)} onChange={e => onSaveViewport(d.uuid, { ...vp, x: Number(e.target.value) })} className="h-6 text-xs px-1.5 font-mono" />
                                                        </div>
                                                        <div className="flex flex-col gap-1">
                                                            <span className="text-[9px] text-slate-500">Y</span>
                                                            <Input type="number" value={Math.round(vp.y)} onChange={e => onSaveViewport(d.uuid, { ...vp, y: Number(e.target.value) })} className="h-6 text-xs px-1.5 font-mono" />
                                                        </div>
                                                        <div className="flex flex-col gap-1">
                                                            <span className="text-[9px] text-slate-500">Width</span>
                                                            <Input type="number" value={Math.round(vp.width)} onChange={e => onSaveViewport(d.uuid, { ...vp, width: Number(e.target.value) })} className="h-6 text-xs px-1.5 font-mono" />
                                                        </div>
                                                        <div className="flex flex-col gap-1">
                                                            <span className="text-[9px] text-slate-500">Height</span>
                                                            <Input type="number" value={Math.round(vp.height)} onChange={e => onSaveViewport(d.uuid, { ...vp, height: Number(e.target.value) })} className="h-6 text-xs px-1.5 font-mono" />
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

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

                    <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" className="w-full justify-start text-xs h-8 font-semibold text-slate-600">
                                    <Monitor className="w-4 h-4 mr-2" /> 仮想モニターを追加
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-56">
                                <DropdownMenuItem onClick={() => {
                                    const url = `${window.location.origin}/display`;
                                    navigator.clipboard.writeText(url);
                                    alert(`コピーしました: ${url}`);
                                }}>
                                    <Copy className="w-4 h-4 mr-2" /> URLをクリップボードにコピー
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => window.open("/display", "_blank")}>
                                    <ExternalLink className="w-4 h-4 mr-2" /> 新しいタブで開く
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                            variant="outline"
                            className="w-full justify-start text-xs h-8 font-semibold text-rose-600 border-rose-200 hover:bg-rose-50"
                            onClick={() => {
                                const newId = "fz_" + Date.now();
                                onUpdateForbiddenZones([...forbiddenZones, {
                                    id: newId,
                                    x: worldW / 2 - 200, y: worldH / 2 - 200,
                                    width: 400, height: 400
                                }]);
                            }}
                        >
                            <Ban className="w-4 h-4 mr-2" /> 侵入禁止エリアを追加
                        </Button>
                        <Button
                            variant="outline"
                            disabled={spawnPoints.length >= 1}
                            className="w-full justify-start text-xs h-8 font-semibold text-sky-600 border-sky-200 hover:bg-sky-50 disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-200"
                            onClick={() => {
                                const newId = "sp_" + Date.now();
                                onUpdateSpawnPoints([{
                                    id: newId,
                                    x: worldW / 2, y: worldH / 2
                                }]);
                            }}
                        >
                            <Sparkles className="w-4 h-4 mr-2" /> {spawnPoints.length >= 1 ? "放流ポイント (配置済み)" : "放流ポイントを追加"}
                        </Button>
                    </div>
                </TabsContent>

                {/* --- レイヤー タブ --- */}
                <TabsContent value="layers" className="flex-1 overflow-y-auto p-4 m-0 data-[state=inactive]:hidden flex flex-col gap-4">
                    <div className="flex justify-between gap-2">
                        <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => {
                            const newZ = layers.length > 0 ? Math.max(...layers.map(l => l.zIndex)) + 1 : 0;
                            onUpdateLayers([{ id: "L_" + Date.now(), name: "画像レイヤー", type: "image", zIndex: newZ, visible: true, opacity: 1 }, ...layers]);
                        }}>
                            <ImageIcon className="w-3.5 h-3.5 mr-1.5" /> 画像を追加
                        </Button>
                        <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => {
                            const newZ = layers.length > 0 ? Math.max(...layers.map(l => l.zIndex)) + 1 : 0;
                            onUpdateLayers([{ id: "L_" + Date.now(), name: "魚レイヤー", type: "fish", zIndex: newZ, visible: true, opacity: 1 }, ...layers]);
                        }}>
                            <Layers className="w-3.5 h-3.5 mr-1.5" /> 魚層を追加
                        </Button>
                    </div>

                    <div className="flex flex-col gap-3">
                        {[...layers].sort((a, b) => b.zIndex - a.zIndex).map((layer, index, sortedLayers) => {
                            const isSystem = layer.id === "layer_system";
                            const isFirst = index === 0;
                            const isLast = index === sortedLayers.length - 1;
                            const moveUp = () => {
                                if (isFirst || isSystem) return;
                                const prev = sortedLayers[index - 1];
                                onUpdateLayers(layers.map(l => {
                                    if (l.id === layer.id) return { ...l, zIndex: prev.zIndex };
                                    if (l.id === prev.id) return { ...l, zIndex: layer.zIndex };
                                    return l;
                                }));
                            };
                            const moveDown = () => {
                                if (isLast || isSystem) return;
                                const next = sortedLayers[index + 1];
                                if (next.id === "layer_system") return; // システムより下には行けない
                                onUpdateLayers(layers.map(l => {
                                    if (l.id === layer.id) return { ...l, zIndex: next.zIndex };
                                    if (l.id === next.id) return { ...l, zIndex: layer.zIndex };
                                    return l;
                                }));
                            };
                            const isActive = activeLayerId === layer.id;

                            return (
                                <div
                                    key={layer.id}
                                    className={`border rounded p-3 flex flex-col gap-3 shadow-sm transition-all
                                    ${!layer.visible ? 'opacity-60 grayscale bg-slate-50' : 'bg-white'} 
                                    ${isActive ? 'border-sky-500 ring-1 ring-sky-500' : 'border-slate-200 hover:border-slate-300'}
                                `}
                                    onClick={() => onSetActiveLayerId?.(layer.id)}
                                >
                                    <div className="flex items-center gap-2 justify-between">
                                        <div className="flex items-center gap-2 flex-1">
                                            <div className="flex flex-col -gap-1 mr-1">
                                                <Button variant="ghost" size="icon" className="w-5 h-5 text-slate-400 hover:text-slate-700" onClick={(e) => { e.stopPropagation(); moveUp(); }} disabled={isFirst || isSystem}>
                                                    <ChevronUp className="w-4 h-4" />
                                                </Button>
                                                <Button variant="ghost" size="icon" className="w-5 h-5 text-slate-400 hover:text-slate-700" onClick={(e) => { e.stopPropagation(); moveDown(); }} disabled={isLast || isSystem || sortedLayers[index + 1]?.id === "layer_system"}>
                                                    <ChevronDown className="w-4 h-4" />
                                                </Button>
                                            </div>
                                            <Button variant="ghost" size="icon" className="w-6 h-6 text-slate-400 p-0" onClick={(e) => {
                                                e.stopPropagation();
                                                onUpdateLayers(layers.map(l => l.id === layer.id ? { ...l, visible: !l.visible } : l));
                                            }}>
                                                {layer.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                                            </Button>

                                            {isActive && <CheckCircle2 className="w-4 h-4 text-sky-500" />}
                                            <div className={`p-1 rounded ${layer.type === 'fish' ? 'bg-sky-100 text-sky-600' : layer.type === 'image' ? 'bg-fuchsia-100 text-fuchsia-600' : 'bg-emerald-100 text-emerald-600'}`}>
                                                {layer.type === 'fish' ? <Layers className="w-3.5 h-3.5" /> : layer.type === 'image' ? <ImageIcon className="w-3.5 h-3.5" /> : <Monitor className="w-3.5 h-3.5" />}
                                            </div>
                                            <Input
                                                value={layer.name}
                                                onChange={e => onUpdateLayers(layers.map(l => l.id === layer.id ? { ...l, name: e.target.value } : l))}
                                                onClick={e => e.stopPropagation()}
                                                className="h-7 text-xs font-semibold px-2 flex-1 outline-none border-transparent focus-visible:ring-1 bg-transparent hover:bg-slate-50"
                                            />
                                        </div>
                                        {layer.type === "image" ? (
                                            <Button variant="ghost" size="icon" className="w-6 h-6 text-rose-400 hover:text-rose-600 hover:bg-rose-50" onClick={(e) => {
                                                e.stopPropagation();
                                                onUpdateLayers(layers.filter(l => l.id !== layer.id));
                                                if (activeLayerId === layer.id) onSetActiveLayerId?.(undefined);
                                            }}>
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </Button>
                                        ) : (
                                            <div className="w-6 h-6" /> // spacer for non-deletable items
                                        )}
                                    </div>

                                    <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs">
                                        <span className="text-slate-500 text-[10px] font-mono tracking-wider">Z-INDEX</span>
                                        <div className="flex items-center gap-2">
                                            <Input type="number" value={layer.zIndex} onChange={e => {
                                                onUpdateLayers(layers.map(l => l.id === layer.id ? { ...l, zIndex: Number(e.target.value) || 0 } : l));
                                            }} className="w-16 h-7 text-xs font-mono" />
                                            <span className="text-[10px] text-slate-400">(奥) 0 〜 100 (手前)</span>
                                        </div>

                                        <span className="text-slate-500 text-[10px] font-mono tracking-wider">OPACITY</span>
                                        <div className="flex items-center gap-2">
                                            <Slider
                                                value={[layer.opacity * 100]}
                                                onValueChange={val => onUpdateLayers(layers.map(l => l.id === layer.id ? { ...l, opacity: val[0] / 100 } : l))}
                                                min={0} max={100} step={1} className="flex-1"
                                            />
                                            <span className="w-8 text-right font-mono text-[10px] text-slate-500">{Math.round(layer.opacity * 100)}%</span>
                                        </div>

                                        {layer.type === "image" && (
                                            <>
                                                <span className="text-slate-500 text-[10px] font-mono tracking-wider">IMAGE URL/FILE</span>
                                                <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                                                    <Input value={layer.url || ""} onChange={e => onUpdateLayers(layers.map(l => l.id === layer.id ? { ...l, url: e.target.value } : l))} placeholder="https://... またはファイル選択" className="h-7 text-xs flex-1" />
                                                    <Button variant="outline" size="icon" className="w-7 h-7 relative overflow-hidden flex-shrink-0 cursor-pointer hover:bg-slate-100">
                                                        <Upload className="w-3.5 h-3.5" />
                                                        <input type="file" accept="image/png, image/jpeg, image/gif, image/webp" className="absolute inset-0 opacity-0 cursor-pointer" onChange={e => handleFileUpload(e, layer.id)} />
                                                    </Button>
                                                </div>

                                                <span className="text-slate-500 text-[10px] font-mono tracking-wider">ASPECT RATIO</span>
                                                <div className="flex items-center gap-2 h-7" onClick={e => e.stopPropagation()}>
                                                    <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                                                        <input
                                                            type="checkbox"
                                                            checked={layer.aspectRatioLocked || false}
                                                            onChange={e => onUpdateLayers(layers.map(l => l.id === layer.id ? { ...l, aspectRatioLocked: e.target.checked } : l))}
                                                            className="form-checkbox h-3.5 w-3.5 text-sky-500 rounded-sm border-slate-300"
                                                        />
                                                        比率を固定してリサイズ
                                                    </label>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
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
                                <Input key={`world-width-${worldW}`} id="world-width" type="number" min={100} defaultValue={worldW} onBlur={e => onUpdateWorldSize(Math.max(100, Number(e.target.value) || worldW), worldH)} className="font-mono bg-white text-slate-800 h-8 focus:ring-1 focus:ring-sky-500" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="world-height" className="text-xs text-slate-500">World Height</Label>
                                <Input key={`world-height-${worldH}`} id="world-height" type="number" min={100} defaultValue={worldH} onBlur={e => onUpdateWorldSize(worldW, Math.max(100, Number(e.target.value) || worldH))} className="font-mono bg-white text-slate-800 h-8 focus:ring-1 focus:ring-sky-500" />
                            </div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="horizontal-boundary" className="text-xs text-slate-500">左右端の動作</Label>
                            <select
                                id="horizontal-boundary"
                                value={horizontalBoundaryMode}
                                onChange={e => onUpdateHorizontalBoundaryMode(e.target.value as HorizontalBoundaryMode)}
                                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700"
                            >
                                <option value="wrap">反対側から出る</option>
                                <option value="bounce">壁で折り返す</option>
                            </select>
                        </div>
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs text-slate-500">魚の全体速度</Label>
                                <span className="font-mono text-xs text-slate-600">×{fishSpeedMultiplier.toFixed(2)}</span>
                            </div>
                            <Slider
                                value={[fishSpeedMultiplier]}
                                onValueChange={value => onUpdateFishSpeedMultiplier(value[0])}
                                min={0.1}
                                max={3}
                                step={0.05}
                            />
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
