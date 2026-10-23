import type { MiddlewareHandler } from "hono";
import { hash } from "./security";

// Keep this policy in sync with public/_headers (assets bypass the Worker).
// React/Recharts use style attributes; scripts allow this origin and the existing
// Cloudflare-injected performance beacon only (no inline scripts or JavaScript eval; WASM is used by local OCR).
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export function protectApiResponse(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const REQUEST_BODY_LIMITS = {
  json: 128 * 1024,
  ai: 100000, // Preserve the existing AI limit.
  extract: 5 * 1024 * 1024 + 128 * 1024,
  upload: 20 * 1024 * 1024 + 128 * 1024,
} as const;

export function requestBodyLimit(path: string, method: string) {
  if (method === "POST" && path === "/api/specs/extract")
    return REQUEST_BODY_LIMITS.extract;
  if (method === "POST" && /^\/api\/components\/[^/]+\/specs$/.test(path))
    return REQUEST_BODY_LIMITS.upload;
  if (path.startsWith("/api/ai/")) return REQUEST_BODY_LIMITS.ai;
  return REQUEST_BODY_LIMITS.json;
}

// Check both the declared and actual bytes before a parser or DB call consumes
// the body. This also bounds streamed requests with no Content-Length.
export const boundedRequestBody: MiddlewareHandler = async (c, next) => {
  const request = c.req.raw;
  if (!request.body) return next();
  const limit = requestBodyLimit(c.req.path, c.req.method);
  const declared = request.headers.get("Content-Length");
  const tooLarge = () =>
    new Response(JSON.stringify({ error: "request-too-large" }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
  if (declared && Number(declared) > limit) return tooLarge();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        return tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  // Recreate the bounded stream without an extra copy of large multipart bodies.
  c.req.raw = new Request(request, {
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    // Node's local tests require duplex; Workers ignores this extra option.
    ...{ duplex: "half" },
  });
  await next();
};

export async function reserveRate(
  db: D1Database,
  key: string,
  max: number,
  windowS: number,
  t = Math.floor(Date.now() / 1000),
) {
  const row = await db
    .prepare(
      "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE MIN(count+1,?) END,expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END RETURNING count,expires_at",
    )
    .bind(await hash(key), t + windowS, t, max + 1, t, t + windowS)
    .first<{ count: number; expires_at: number }>();
  if (!row) throw new Error("rate-reservation-failed");
  return {
    allowed: row.count <= max,
    retryAfter: Math.max(1, row.expires_at - t),
  };
}

export function rateLimited(retryAfter: number) {
  return new Response(JSON.stringify({ error: "rate-limited" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfter),
    },
  });
}
