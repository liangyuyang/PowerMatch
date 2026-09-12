export interface PriceOption {
  label: string;
  inputPrice: number;
  outputPrice: number;
  cacheHitPrice: number | null;
  currency: "CNY" | "USD";
  billingMode: "tokens";
  priceNote: string;
}
function plain(html: string) {
  return html
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
// Expand merged table cells before matching model/price columns. No HTML is executed.
export function tableRows(html: string) {
  const rows: string[][] = [];
  for (const [y, tr] of [
    ...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi),
  ].entries()) {
    if (y >= 200) throw Error("price-table-too-large");
    rows[y] ??= [];
    let x = 0;
    for (const cell of tr[1].matchAll(
      /<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi,
    )) {
      while (rows[y][x] !== undefined) x++;
      const span = (name: string) =>
        Number(
          cell[1].match(new RegExp(name + "\\s*=\\s*[\"']?(\\d+)", "i"))?.[1] ??
            1,
        );
      const width = span("colspan"),
        height = span("rowspan");
      if (width < 1 || height < 1 || x + width > 40 || y + height > 200)
        throw Error("price-table-too-large");
      for (let yy = y; yy < y + height; yy++) {
        rows[yy] ??= [];
        for (let xx = x; xx < x + width; xx++) rows[yy][xx] = plain(cell[2]);
      }
      x += width;
    }
  }
  return rows;
}
export function parseDeepSeekPricing(
  html: string,
  model: string,
): PriceOption[] {
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  for (const table of tables) {
    const rows = tableRows(table[0]),
      header = rows.find(
        (r) => r.some((c) => /^(MODEL|模型)$/i.test(c)) && r.includes(model),
      );
    if (!header) continue;
    const column = header.indexOf(model),
      prices = new Map<
        string,
        {
          input?: number;
          output?: number;
          cache?: number;
          currency?: "CNY" | "USD";
        }
      >();
    for (const row of rows) {
      const label = row.slice(0, column).join(" "),
        value = row[column] ?? "";
      if (!/百万|1M/i.test(label) || !/输入|输出|INPUT|OUTPUT/i.test(label))
        continue;
      const match = value.match(
        /^([¥￥$]?)\s*(\d+(?:\.\d+)?)\s*(元|USD|CNY)?$/i,
      );
      if (!match) throw Error("price-format-unsupported");
      const currency: "USD" | "CNY" | null =
        match[1] === "$" || match[3] === "USD"
          ? "USD"
          : /[¥￥]/.test(match[1]) || /元|CNY/.test(match[3] ?? "")
            ? "CNY"
            : null;
      if (!currency) throw Error("price-currency-unknown");
      const slot = /空闲|OFF.PEAK/i.test(label)
        ? "空闲时段"
        : /高峰|PEAK/i.test(label)
          ? "高峰时段"
          : "标准价格";
      const p = prices.get(slot) ?? {};
      if (p.currency && p.currency !== currency)
        throw Error("price-currency-ambiguous");
      p.currency = currency;
      const kind = /输出|OUTPUT/i.test(label)
        ? "output"
        : /未命中|CACHE MISS/i.test(label)
          ? "input"
          : /缓存命中|CACHE HIT/i.test(label)
            ? "cache"
            : "input";
      if (p[kind] !== undefined) throw Error("price-tier-ambiguous");
      p[kind] = Number(match[2]);
      prices.set(slot, p);
    }
    const result: PriceOption[] = [];
    for (const [label, p] of prices) {
      if (p.input === undefined || p.output === undefined || !p.currency)
        throw Error("price-incomplete");
      result.push({
        label,
        inputPrice: p.input,
        outputPrice: p.output,
        cacheHitPrice: p.cache ?? null,
        currency: p.currency,
        billingMode: "tokens",
        priceNote: `DeepSeek 官方价格：${label}；输入按缓存未命中估算。缓存命中单价 ${p.cache ?? "未提供"} ${p.currency}/百万 Token。当前计费不自动区分缓存与高峰/空闲，请选择适用档位；以供应商账单为准。`,
      });
    }
    if (!result.length) throw Error("price-not-found");
    return result;
  }
  throw Error("price-model-not-found");
}
function allowed(source: string) {
  try {
    const u = new URL(source);
    return (
      u.protocol === "https:" &&
      u.hostname === "api-docs.deepseek.com" &&
      !u.port &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      /^\/(?:zh-cn\/)?quick_start\/pricing\/?$/.test(u.pathname)
    );
  } catch {
    return false;
  }
}
export async function readPrices(
  provider: string,
  model: string,
  source: string,
) {
  if (provider !== "deepseek" || !allowed(source))
    throw Error("price-source-unsupported");
  const signal = AbortSignal.timeout(15000);
  let url = source;
  for (let hop = 0; hop < 3; hop++) {
    let r: Response;
    try {
      r = await fetch(url, {
        redirect: "manual",
        signal,
        headers: { Accept: "text/html" },
      });
    } catch {
      throw Error("price-fetch-failed");
    }
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const next = new URL(r.headers.get("location") ?? "", url).href;
      if (!allowed(next)) throw Error("price-redirect-rejected");
      url = next;
      continue;
    }
    if (!r.ok) throw Error(`price-http-${r.status}`);
    const reader = r.body?.getReader();
    if (!reader) throw Error("price-empty");
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 300000) {
          await reader.cancel();
          throw Error("price-page-too-large");
        }
        chunks.push(value);
      }
    } catch (e) {
      if (e instanceof Error && e.message === "price-page-too-large") throw e;
      throw Error("price-fetch-failed");
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return {
      source: url,
      model,
      checkedAt: new Date().toISOString(),
      options: parseDeepSeekPricing(new TextDecoder().decode(bytes), model),
    };
  }
  throw Error("price-too-many-redirects");
}
