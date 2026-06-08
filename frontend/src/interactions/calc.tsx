import { useMemo, useState } from "react";

interface Input {
  key: string;
  label: string;
  default: number;
  unit?: string;
}

export interface CalcProps {
  title?: string;
  inputs: Input[];
  formula: string; // expression over input keys, e.g. "dau * perUser"
  resultLabel?: string;
  resultUnit?: string;
}

function humanize(n: number): string {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + " trillion";
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + " billion";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + " million";
  if (abs >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toLocaleString();
}

// A back-of-the-envelope calculator authored from content: edit the inputs and
// the formula (a trusted expression over the input keys) recomputes live. Helps
// readers build estimation intuition by changing assumptions and seeing impact.
export function Calc({ title, inputs, formula, resultLabel, resultUnit }: CalcProps) {
  const [vals, setVals] = useState<Record<string, number>>(() =>
    Object.fromEntries(inputs.map((i) => [i.key, i.default])),
  );

  const compute = useMemo(() => {
    const keys = inputs.map((i) => i.key);
    try {
      // Formula comes from trusted chapter content (not user input).
      // eslint-disable-next-line no-new-func
      return new Function(...keys, `return (${formula});`) as (...a: number[]) => number;
    } catch {
      return () => NaN;
    }
  }, [inputs, formula]);

  let result = NaN;
  try {
    result = compute(...inputs.map((i) => vals[i.key]));
  } catch {
    result = NaN;
  }

  return (
    <div className="interaction">
      {title && <div className="prompt">{title}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {inputs.map((i) => (
          <label key={i.key} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0.6rem", alignItems: "center" }}>
            <span style={{ fontSize: "0.9rem", color: "var(--zen-color-foreground)" }}>
              {i.label}
              {i.unit ? ` (${i.unit})` : ""}
            </span>
            <input
              type="number"
              value={vals[i.key]}
              onChange={(e) =>
                setVals((v) => ({ ...v, [i.key]: Number(e.target.value) }))
              }
              className="calc-input"
            />
          </label>
        ))}
      </div>
      <div className="feedback" style={{ marginTop: "0.9rem", fontSize: "1.05rem" }}>
        <span style={{ color: "var(--zen-color-muted-fg)" }}>{resultLabel ?? "Result"}: </span>
        <strong style={{ color: "var(--zen-color-primary)" }}>
          {humanize(result)}
          {resultUnit ? ` ${resultUnit}` : ""}
        </strong>
      </div>
    </div>
  );
}
