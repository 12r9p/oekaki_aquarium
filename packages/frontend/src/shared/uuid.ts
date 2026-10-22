// ============================================================
// shared/uuid.ts
// セキュア/非セキュアコンテキスト対応のランダムID生成ユーティリティ
// ============================================================

export function generateShortId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().slice(0, 8);
  }
  // 非セキュアコンテキスト(http://192.168.x.x 等)用の簡易ランダム文字列生成フォールバック
  return Math.random().toString(36).substring(2, 10);
}

export function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // 非セキュアコンテキストでも使える getRandomValues で UUID v4 形式を組み立てる
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
