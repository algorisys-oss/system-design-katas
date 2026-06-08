import { useState } from "react";
import { Slider, Badge } from "@algorisys/zen-ui-react";

interface TradeoffStep {
  label: string;
  detail: string;
}

export interface TradeoffProps {
  title?: string;
  // The two poles of the trade-off axis (e.g. Consistency ↔ Availability).
  axis?: { left: string; right: string };
  // Ordered positions along the axis; sliding selects one and shows its detail.
  steps: TradeoffStep[];
}

// A trade-off slider: drag along an axis between two competing properties and
// see the consequence at each position. Teaches that design is about choosing a
// point on a spectrum, not a binary — change the dial, see what you gain/give up.
export function Tradeoff({ title, axis, steps }: TradeoffProps) {
  const last = Math.max(0, steps.length - 1);
  const [i, setI] = useState(() => Math.floor(last / 2));
  const current = steps[i] ?? { label: "", detail: "" };

  return (
    <div className="interaction tradeoff">
      {title && <div className="prompt">{title}</div>}

      {axis && (
        <div className="tradeoff-poles">
          <span>◀ {axis.left}</span>
          <span>{axis.right} ▶</span>
        </div>
      )}

      <Slider
        value={[i]}
        min={0}
        max={last}
        step={1}
        onValueChange={(v: number[]) => setI(v[0] ?? 0)}
        aria-label={title ?? "trade-off"}
      />

      <div className="tradeoff-ticks">
        {steps.map((s, idx) => (
          <button
            key={idx}
            type="button"
            className={`tradeoff-tick${idx === i ? " active" : ""}`}
            onClick={() => setI(idx)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="feedback tradeoff-detail">
        <Badge>{current.label}</Badge>
        <p>{current.detail}</p>
      </div>
    </div>
  );
}
