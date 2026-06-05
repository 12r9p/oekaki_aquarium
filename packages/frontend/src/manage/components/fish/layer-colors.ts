export function getLayerGradient(index: number, total: number): string {
    if (index < 0) return "linear-gradient(90deg, #64748b, #94a3b8)";
    const hue = Math.round(198 + (Math.max(total - 1, 1) === 0 ? 0 : (index / Math.max(total - 1, 1)) * 86));
    return `linear-gradient(90deg, hsl(${hue} 82% 47%), hsl(${Math.min(hue + 26, 320)} 78% 58%))`;
}

export function getLayerLabel(index: number | undefined, isArchived?: boolean): string {
    if (isArchived) return "非表示";
    return `Lyr ${index ?? 0}`;
}
