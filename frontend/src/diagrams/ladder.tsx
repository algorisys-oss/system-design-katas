import { useState } from "react";
import { Button } from "@algorisys/zen-ui-react";

interface Item {
  label: string;
  ns: number; // latency in nanoseconds
}

export interface LadderProps {
  title?: string;
  items: Item[];
}

function realTime(ns: number): string {
  if (ns < 1e3) return `${round(ns)} ns`;
  if (ns < 1e6) return `${round(ns / 1e3)} µs`;
  if (ns < 1e9) return `${round(ns / 1e6)} ms`;
  return `${round(ns / 1e9)} s`;
}

// "If 1 ns took 1 second…" — scale ns→seconds and humanize.
function humanScale(ns: number): string {
  let s = ns; // 1 ns -> 1 s
  if (s < 60) return `${round(s)} sec`;
  if (s < 3600) return `${round(s / 60)} min`;
  if (s < 86400) return `${round(s / 3600)} hours`;
  if (s < 31536000) return `${round(s / 86400)} days`;
  return `${round(s / 31536000)} years`;
}

function round(n: number): string {
  if (n >= 100) return Math.round(n).toLocaleString();
  if (n >= 10) return n.toFixed(0);
  return n.toFixed(1).replace(/\.0$/, "");
}

// Log-scaled latency ladder. Bars are log10(ns) so 6+ orders of magnitude fit
// on screen; a toggle re-labels everything in "human time" (1 ns = 1 s) to make
// the scale visceral. Themed via --zen-* tokens.
export function Ladder({ title, items }: LadderProps) {
  const [human, setHuman] = useState(false);
  const logs = items.map((i) => Math.log10(Math.max(1, i.ns)));
  const maxLog = Math.max(...logs);

  return (
    <div className="interaction">
      <div className="topbar">
        <div className="prompt" style={{ margin: 0 }}>
          {title ?? "Latency ladder"}
        </div>
        <Button
          size="sm"
          variant={human ? "soft" : "outline"}
          color={human ? "info" : "neutral"}
          onClick={() => setHuman((h) => !h)}
        >
          {human ? "Human scale: 1 ns = 1 s ✓" : "Show human scale"}
        </Button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.75rem" }}>
        {items.map((it, idx) => {
          const pct = 6 + (logs[idx] / maxLog) * 94;
          return (
            <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: "0.6rem", alignItems: "center" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--zen-color-foreground)" }}>{it.label}</span>
              <div style={{ background: "var(--zen-color-muted)", borderRadius: 4, overflow: "hidden", height: 18 }}>
                <div
                  style={{
                    width: `${pct}%`,
                    height: "100%",
                    background: "var(--zen-color-primary)",
                    boxShadow: "0 0 10px rgba(0,255,156,0.4)",
                  }}
                />
              </div>
              <span style={{ fontSize: "0.82rem", color: "var(--zen-color-info)", whiteSpace: "nowrap", textAlign: "right", minWidth: 96 }}>
                {human ? humanScale(it.ns) : realTime(it.ns)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="feedback" style={{ color: "var(--zen-color-muted-fg)" }}>
        Bars are log-scaled (each step ≈ one order of magnitude). Toggle the human scale to feel how
        far apart these really are.
      </div>
    </div>
  );
}
