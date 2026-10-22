import { useEffect, useRef, useState } from "react";
import type { Design } from "./shared/model";
import { CalculationClient, calculationKey } from "./calculation-client";

export function useCalculations(designs: Design[]) {
  const client = useRef<CalculationClient | null>(null);
  if (!client.current) client.current = new CalculationClient();
  const signature = JSON.stringify(designs.map(calculationKey));
  const [state, setState] = useState({ signature: "", error: "", completed: 0 });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const service = client.current!;
    const controller = new AbortController();
    let active = true;
    // Briefly coalesce numeric typing; the UI hides obsolete results immediately.
    const timer = setTimeout(() => {
      setState({ signature, error: "", completed: 0 });
      void (async () => {
        try {
          const unique = [...new Map(designs.map(d => [calculationKey(d), d])).values()];
          for (const [index, design] of unique.entries()) {
            await service.calculate(design, controller.signal);
            if (!active) return;
            setState({ signature, error: "", completed: index + 1 });
          }
        } catch (error) {
          if (active && !controller.signal.aborted) setState({ signature, completed: 0,
            error: error instanceof Error ? error.message : "calculation-worker-failed" });
        }
      })();
    }, 80);
    return () => { active = false; clearTimeout(timer); controller.abort(); service.cancel(); };
    // The signature deliberately excludes non-engine metadata. `designs` belongs to this input batch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, attempt]);
  const results = designs.map(design => client.current!.peek(calculationKey(design)) ?? null);
  return { results, pending: results.some(r => r === null) && !(state.signature === signature && state.error),
    error: state.signature === signature ? state.error : "", retry: () => setAttempt(n => n + 1) };
}
