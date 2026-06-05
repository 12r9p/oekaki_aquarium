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
