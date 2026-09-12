import {
  employeeEmail,
  publicName,
  type Viewer,
  type Locale,
} from "../src/shared/model";
export const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
export async function hash(value: string | ArrayBuffer) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        typeof value === "string" ? new TextEncoder().encode(value) : value,
      ),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function toViewer(row: Record<string, unknown>): Viewer {
  return {
    id: String(row.id),
    email: String(row.email),
    name: publicName(String(row.email)),
    employee: employeeEmail(String(row.email)),
    admin: String(row.email) === "patrick@miaomiaoce.com",
    locale: row.locale as Locale,
    localeMode: row.locale_mode === "manual" ? "manual" : "auto",
    level: 1 + Math.floor(Number(row.posts_count) / 100),
  };
}
export function canReadCase(
  row: {
    scope: string;
    owner_id: string | null;
    guest_hash?: string | null;
    deleted?: number;
  },
  user: Viewer | null,
  guestHash: string,
) {
  if (row.deleted) return false;
  return (
    row.scope === "public" ||
    row.owner_id === user?.id ||
    (row.scope === "company" && !!user?.employee) ||
    !!(row.guest_hash && row.guest_hash === guestHash)
  );
}
export function canEditCase(
  row: {
    owner_id: string | null;
    guest_hash?: string | null;
    official?: number;
  },
  user: Viewer | null,
  guestHash: string,
) {
  return row.official
    ? !!user?.admin
    : row.owner_id
      ? row.owner_id === user?.id
      : !!row.guest_hash && row.guest_hash === guestHash;
}
