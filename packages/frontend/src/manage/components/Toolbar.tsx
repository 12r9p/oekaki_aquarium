import React from "react";
import type { DisplayClientInfo, ActiveFish, PendingFish } from "@aquarium/shared";
import { CircleGauge, Fish, Layers, Settings, Send, Waves, Menu, X, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ManagePage = "dashboard" | "layout" | "fish" | "pending" | "motion" | "settings";

interface ToolbarProps {
    displays: DisplayClientInfo[];
    activeFish: ActiveFish[];
    pendingFish: PendingFish[];
    connected: boolean;
    tab: ManagePage;
    setTab: (t: ManagePage) => void;
}

export function Toolbar({
    displays, activeFish, pendingFish, connected,
    tab, setTab
}: ToolbarProps): React.ReactElement {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
    const [isCollapsed, setIsCollapsed] = React.useState(false);
    const openButtonRef = React.useRef<HTMLButtonElement>(null);
    const closeButtonRef = React.useRef<HTMLButtonElement>(null);
    const drawerRef = React.useRef<HTMLElement>(null);
    const isFirstRender = React.useRef(true);

    React.useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }
        if (isMobileMenuOpen) {
            const timer = setTimeout(() => {
                closeButtonRef.current?.focus();
            }, 0);
            return () => clearTimeout(timer);
        } else {
            openButtonRef.current?.focus();
        }
    }, [isMobileMenuOpen]);

    React.useEffect(() => {
        if (!isMobileMenuOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setIsMobileMenuOpen(false);
                return;
            }

            if (e.key === "Tab") {
                if (!drawerRef.current) return;
                const focusableElements = drawerRef.current.querySelectorAll(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                );
                if (focusableElements.length === 0) return;
                const firstElement = focusableElements[0] as HTMLElement;
                const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

                if (e.shiftKey) {
                    if (document.activeElement === firstElement) {
                        lastElement.focus();
                        e.preventDefault();
                    } else if (document.activeElement && !drawerRef.current.contains(document.activeElement)) {
                        firstElement.focus();
                        e.preventDefault();
                    }
                } else {
                    if (document.activeElement === lastElement) {
                        firstElement.focus();
                        e.preventDefault();
                    } else if (document.activeElement && !drawerRef.current.contains(document.activeElement)) {
                        firstElement.focus();
                        e.preventDefault();
                    }
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown, true);
        return () => window.removeEventListener("keydown", handleKeyDown, true);
    }, [isMobileMenuOpen]);

    const navItems = [
        ["dashboard", "ステータス", CircleGauge],
        ["fish", "魚", Fish],
        ["pending", "承認待ち", Send],
        ["layout", "水槽レイアウト", Layers],
        ["motion", "魚の動き", Waves],
        ["settings", "設定", Settings],
    ] as const;

    return (
        <>
            {/* Top Bar for Mobile/Tablet */}
            <div className="flex h-16 w-full items-center justify-between border-b border-slate-800 bg-slate-950 px-4 text-slate-200 lg:hidden flex-shrink-0">
                <Button
                    ref={openButtonRef}
                    onClick={() => setIsMobileMenuOpen(true)}
                    variant="ghost"
                    size="icon"
                    className="text-slate-300 hover:bg-slate-900 hover:text-white"
                    aria-label="メニューを開く"
                >
                    <Menu className="h-6 w-6" />
                </Button>
                <div className="flex items-center gap-3">
                    <div className="h-3 w-3 rounded-full bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.75)]" />
                    <div className="text-left">
                        <div className="text-sm font-bold text-white leading-tight">お絵かき水族館</div>
                        <div className="text-[10px] font-medium text-slate-400 leading-none">運用管理</div>
                    </div>
                </div>
                <div className={`flex items-center gap-1.5 text-xs font-bold ${connected ? "text-emerald-400" : "text-rose-400"}`}>
                    <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-400"}`} />
                </div>
            </div>

            {/* Permanent Sidebar for Desktop */}
            <aside className={`hidden lg:flex flex-col border-r border-slate-200 bg-slate-950 text-slate-200 transition-all duration-300 ${isCollapsed ? "w-20" : "w-60"} flex-shrink-0`}>
                <div className={`flex h-16 items-center border-b border-slate-800 px-5 flex-shrink-0 ${isCollapsed ? "justify-center" : "justify-between"}`}>
                    {!isCollapsed && (
                        <div className="flex items-center gap-3">
                            <div className="h-3 w-3 rounded-full bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.75)]" />
                            <div>
                                <div className="text-sm font-bold text-white leading-tight">お絵かき水族館</div>
                                <div className="text-[10px] font-medium text-slate-400 leading-none">運用管理</div>
                            </div>
                        </div>
                    )}
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className="text-slate-400 hover:bg-slate-900 hover:text-white"
                        aria-label={isCollapsed ? "ナビゲーションを展開" : "ナビゲーションを折りたたむ"}
                        title={isCollapsed ? "展開" : "折りたたむ"}
                    >
                        {isCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                    </Button>
                </div>
                <nav className={`flex flex-1 flex-col gap-1 p-3 ${isCollapsed ? "items-center" : ""}`}>
                    {navItems.map(([value, label, Icon]) => (
                        <Button
                            key={value}
                            variant={tab === value ? "default" : "ghost"}
                            onClick={() => setTab(value)}
                            className={`relative justify-start text-sm font-semibold transition-colors ${
                                tab === value ? "bg-sky-500 hover:bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-900 hover:text-white"
                            } ${isCollapsed ? "h-10 w-10 px-0 justify-center" : "w-full gap-3 px-3 py-2.5"}`}
                            aria-label={label}
                            title={label}
                        >
                            <Icon className="h-4 w-4 flex-shrink-0" />
                            {!isCollapsed && <span className="flex-1 text-left">{label}</span>}
                            {!isCollapsed && value === "pending" && pendingFish.length > 0 && (
                                <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-amber-950">
                                    {pendingFish.length}
                                </span>
                            )}
                            {isCollapsed && value === "pending" && pendingFish.length > 0 && (
                                <span className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-amber-400" />
                            )}
                        </Button>
                    ))}
                </nav>
                {isCollapsed ? (
                    <div className="border-t border-slate-800 p-2 flex-shrink-0 flex flex-col items-center gap-3">
                        <div className="flex flex-col gap-1 items-center">
                            <div className="text-xs font-bold text-white" title={`${displays.length}台の端末`}>{displays.length}台</div>
                            <div className="text-xs font-bold text-white" title={`${activeFish.length}匹の魚`}>{activeFish.length}匹</div>
                        </div>
                        <div className="flex items-center justify-center" title={connected ? "サーバー接続中" : "サーバー切断中"}>
                            <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" : "bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.5)]"}`} />
                        </div>
                    </div>
                ) : (
                    <div className="border-t border-slate-800 p-4 flex-shrink-0">
                        <div className="grid grid-cols-2 gap-2 text-center">
                            <div className="rounded-lg bg-slate-900 p-2"><div className="text-lg font-bold text-white">{displays.length}</div><div className="text-[10px] text-slate-400">端末</div></div>
                            <div className="rounded-lg bg-slate-900 p-2"><div className="text-lg font-bold text-white">{activeFish.length}</div><div className="text-[10px] text-slate-400">魚</div></div>
                        </div>
                        <div className={`mt-3 flex items-center gap-2 text-xs font-bold ${connected ? "text-emerald-400" : "text-rose-400"}`}>
                            <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-400"}`} />
                            {connected ? "サーバー接続中" : "サーバー切断中"}
                        </div>
                    </div>
                )}
            </aside>

            {/* Mobile/Tablet Drawer Menu Overlay */}
            {isMobileMenuOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        onClick={() => setIsMobileMenuOpen(false)}
                        className="fixed inset-0 z-40 bg-black/60 lg:hidden"
                    />
                    {/* Drawer Content */}
                    <aside
                        ref={drawerRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label="メニュー"
                        className="fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-slate-950 text-slate-200 lg:hidden"
                    >
                        <div className="flex h-16 items-center justify-between border-b border-slate-800 px-5 flex-shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="h-3 w-3 rounded-full bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.75)]" />
                                <div>
                                    <div className="text-sm font-bold text-white">お絵かき水族館</div>
                                    <div className="text-[10px] font-medium text-slate-400">運用管理</div>
                                </div>
                            </div>
                            <Button
                                ref={closeButtonRef}
                                onClick={() => setIsMobileMenuOpen(false)}
                                variant="ghost"
                                size="icon"
                                className="text-slate-300 hover:bg-slate-900 hover:text-white"
                                aria-label="メニューを閉じる"
                            >
                                <X className="h-5 w-5" />
                            </Button>
                        </div>
                        <nav className="flex flex-1 flex-col gap-1 p-3">
                            {navItems.map(([value, label, Icon]) => (
                                <Button
                                    key={value}
                                    variant={tab === value ? "default" : "ghost"}
                                    onClick={() => {
                                        setTab(value);
                                        setIsMobileMenuOpen(false);
                                    }}
                                    className={`w-full justify-start gap-3 text-sm font-semibold transition-colors ${
                                        tab === value ? "bg-sky-500 hover:bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-900 hover:text-white"
                                    } px-3 py-2.5`}
                                >
                                    <Icon className="h-4 w-4" />
                                    <span className="flex-1 text-left">{label}</span>
                                    {value === "pending" && pendingFish.length > 0 && (
                                        <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-amber-950">
                                            {pendingFish.length}
                                        </span>
                                    )}
                                </Button>
                            ))}
                        </nav>
                        <div className="border-t border-slate-800 p-4 flex-shrink-0">
                            <div className="grid grid-cols-2 gap-2 text-center">
                                <div className="rounded-lg bg-slate-900 p-2"><div className="text-lg font-bold text-white">{displays.length}</div><div className="text-[10px] text-slate-400">端末</div></div>
                                <div className="rounded-lg bg-slate-900 p-2"><div className="text-lg font-bold text-white">{activeFish.length}</div><div className="text-[10px] text-slate-400">魚</div></div>
                            </div>
                            <div className={`mt-3 flex items-center gap-2 text-xs font-bold ${connected ? "text-emerald-400" : "text-rose-400"}`}>
                                <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-400"}`} />
                                {connected ? "サーバー接続中" : "サーバー切断中"}
                            </div>
                        </div>
                    </aside>
                </>
            )}
        </>
    );
}
