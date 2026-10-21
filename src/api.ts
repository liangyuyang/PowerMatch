export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
let catalog: { etag: string; value: unknown } | undefined;
export async function api(
  path: string,
  data?: unknown,
  method?: string,
  expectedActor?: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
) {
  const verb = method ?? (data ? "POST" : "GET");
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    options.timeoutMs ?? (data instanceof FormData ? 120000 : 30000),
  );
  const cached = path === "/components" && verb === "GET" ? catalog : undefined;
  try {
    const response = await fetch("/api" + path, {
      method: verb,
      signal: controller.signal,
      headers: {
        ...(data instanceof FormData
          ? {}
          : data
            ? { "Content-Type": "application/json" }
            : {}),
        ...(expectedActor ? { "X-PowerMatch-Actor": expectedActor } : {}),
        ...(cached ? { "If-None-Match": cached.etag } : {}),
      },
      body:
        data instanceof FormData
          ? data
          : data
            ? JSON.stringify(data)
            : undefined,
    });
    if (response.status === 304 && cached) return cached.value as any;
    let result: any;
    try {
      result = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new ApiError(
        `invalid-api-response (HTTP ${response.status})`,
        response.status,
      );
    }
    if (!response.ok)
      throw new ApiError(
        result.error ?? `HTTP ${response.status}`,
        response.status,
      );
    // Only the public catalog is reused. Identity, case and admin data are never cached here.
    if (
      path === "/components" &&
      verb === "GET" &&
      response.headers.get("ETag")
    )
      catalog = { etag: response.headers.get("ETag")!, value: result };
    return result;
  } catch (error) {
    if (timedOut)
      throw new ApiError(
        verb === "GET" ? "request-timeout" : "request-timeout-outcome-unknown",
        0,
      );
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
