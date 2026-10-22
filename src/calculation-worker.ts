import "./csp-runtime";
import { calculate } from "./shared/engine";
import type { Design } from "./shared/model";
import type { CalculationReply } from "./calculation-client";

// This is the same deterministic engine used by the API, without UI-thread integration.
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ id: number; key: string; design: Design }>) => void;
  postMessage: (reply: CalculationReply) => void;
};
scope.onmessage = ({ data: { id, key, design } }) => {
  try { scope.postMessage({ id, key, result: calculate(design) }); }
  catch { scope.postMessage({ id, key, error: "calculation-invalid-input" }); }
};
