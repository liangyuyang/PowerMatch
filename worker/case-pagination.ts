export type CaseCursor = { official: number; updated_at: string; id: string };
export function encodeCaseCursor(row: CaseCursor) {
  return btoa(JSON.stringify([row.official, row.updated_at, row.id]));
}
export function decodeCaseCursor(raw: string | undefined): CaseCursor | null {
  if (!raw) return null;
  if (raw.length > 1000) throw new Error("invalid-cursor");
  try {
    const v = JSON.parse(atob(raw));
    if (
      !Array.isArray(v) ||
      v.length !== 3 ||
      ![0, 1].includes(v[0]) ||
      typeof v[1] !== "string" ||
      v[1].length > 40 ||
      !v[1] ||
      typeof v[2] !== "string" ||
      !v[2] ||
      v[2].length > 200
    )
      throw 0;
    return { official: v[0], updated_at: v[1], id: v[2] };
  } catch {
    throw new Error("invalid-cursor");
  }
}
