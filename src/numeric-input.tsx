import { useState } from "react";
export function NumericInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (raw: string) => void;
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState("");
  return (
    <input
      type="number"
      step="any"
      value={editing ? draft : value === null ? "" : Number(value.toFixed(2))}
      placeholder="—"
      onFocus={() => {
        setDraft(value === null ? "" : String(value));
        setEditing(true);
      }}
      onBlur={() => setEditing(false)}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}
