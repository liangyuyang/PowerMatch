import { NumericInput } from "./numeric-input";
import {
  parseParameters,
  setParameter,
  parameterFields,
  parameterUnits,
} from "./shared/component-parameters";
import type { Locale } from "./shared/model";
import { uiText, type UIText } from "./ui-text";

export function ComponentParameters({
  category,
  value,
  onChange,
  locale,
}: {
  category: string;
  value: string;
  onChange: (value: string) => void;
  locale: Locale;
}) {
  const parameters = parseParameters(value);
  const label = (key: string) =>
    key === "mppt" ? "MPPT" : uiText(locale, key as UIText);
  return (
    <section className="component-parameters">
      <h3>{uiText(locale, "parameters")}</h3>
      <p className="caption">{uiText(locale, "unknownHint")}</p>
      {!parameters && (
        <p role="alert" className="warning">
          {uiText(locale, "invalidParameters")}
        </p>
      )}
      {parameters && (
        <div className="parameter-grid">
          {(parameterFields[category] ?? []).map((key) => {
            const v = parameters[key] ?? null;
            const set = (v: string | number | null) =>
              onChange(setParameter(value, key, v));
            const nano =
              (key === "iqUa" || key === "leakUa") &&
              typeof v === "number" &&
              v !== 0 &&
              Math.abs(v) < 1;
            const unit = nano ? "nA" : parameterUnits[key];
            return (
              <label className="field" key={key}>
                <span>
                  {label(key)}
                  {unit ? ` (${unit})` : ""}
                </span>
                {["mppt", "charger"].includes(key) ? (
                  <select
                    value={String(v ?? "")}
                    onChange={(e) => set(e.target.value || null)}
                  >
                    <option value="">{uiText(locale, "unknown")}</option>
                    <option value="Yes">{uiText(locale, "yes")}</option>
                    <option value="No">{uiText(locale, "no")}</option>
                    {v !== null && !["Yes", "No", ""].includes(String(v)) && (
                      <option value={String(v)}>{String(v)}</option>
                    )}
                  </select>
                ) : key === "chemistry" || typeof v === "string" ? (
                  <input
                    value={v ?? ""}
                    onChange={(e) => set(e.target.value || null)}
                  />
                ) : (
                  <NumericInput
                    value={nano ? (v as number) * 1000 : (v as number | null)}
                    onChange={(raw) =>
                      set(raw === "" ? null : Number(raw) / (nano ? 1000 : 1))
                    }
                  />
                )}
              </label>
            );
          })}
        </div>
      )}
      <details open={!parameters || !parameterFields[category]?.length}>
        <summary>{uiText(locale, "advanced")}</summary>
        <label className="field">
          <span>JSON</span>
          <textarea
            aria-label="JSON"
            spellCheck={false}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      </details>
    </section>
  );
}
