export const pages = [
  "workbench",
  "compare",
  "library",
  "hall",
  "forum",
  "admin",
] as const;
export type Page = (typeof pages)[number];
export function readPage(url: URL): Page {
  const page = url.searchParams.get("page");
  return pages.includes(page as Page) ? (page as Page) : "workbench";
}
export function pageUrl(url: URL, page: Page) {
  const next = new URL(url);
  next.searchParams.delete("case");
  next.searchParams.delete("revision");
  next.searchParams.set("page", page);
  if (next.hash.startsWith("#component=")) next.hash = "";
  return next.pathname + next.search + next.hash;
}
export function caseUrl(url: URL, id: string, revision?: string) {
  const next = new URL(url.origin + url.pathname);
  next.searchParams.set("page", "hall");
  next.searchParams.set("case", id);
  if (revision) next.searchParams.set("revision", revision);
  return next.href;
}
