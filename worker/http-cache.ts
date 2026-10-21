// GET If-None-Match uses weak comparison. Cloudflare may add W/ while
// compressing an unchanged representation; accept lists as well as one tag.
export function matchesETag(header: string | undefined, etag: string) {
  const normalize = (value: string) => value.trim().replace(/^W\//, "");
  return header?.split(",").some((value) =>
    value.trim() === "*" || normalize(value) === normalize(etag),
  ) ?? false;
}
