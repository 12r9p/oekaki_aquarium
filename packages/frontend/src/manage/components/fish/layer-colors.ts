export function getLayerColor(index: number, total: number): string {
    if (index < 0) return "#64748b";
    const hue = Math.round(198 + (Math.max(total - 1, 1) === 0 ? 0 : (index / Math.max(total - 1, 1)) * 86));
    return `hsl(${hue} 82% 47%)`;
}

export function getLayerLabel(index: number | undefined, isArchived?: boolean): string {
    if (isArchived) return "非表示";
    return `Lyr ${index ?? 0}`;
}
