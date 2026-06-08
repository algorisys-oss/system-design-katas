import { useState } from "react";
import { Button } from "@algorisys/zen-ui-react";

interface Step {
  from: string;
  to: string;
  label: string;
}

export interface SequenceProps {
  title?: string;
  actors: string[];
  steps: Step[];
}

// A sequence diagram (lifelines + messages) you step through one message at a
// time — ideal for handshakes (TCP, TLS) and request/response flows. Themed SVG.
export function Sequence({ title, actors, steps }: SequenceProps) {
  const [shown, setShown] = useState(1); // how many messages are revealed
  const colW = 150;
  const topH = 44;
  const stepH = 46;
  const pad = 10;
  const W = actors.length * colW;
  const H = topH + steps.length * stepH + pad;
  const colX = (i: number) => colW * i + colW / 2;

  return (
    <div className="interaction">
      <div className="topbar">
        <div className="prompt" style={{ margin: 0 }}>{title ?? "Sequence"}</div>
        <div className="step-controls" style={{ margin: 0 }}>
          <Button size="sm" variant="outline" color="neutral" disabled={shown <= 1} onClick={() => setShown((n) => Math.max(1, n - 1))}>← Back</Button>
          <Button size="sm" color="primary" disabled={shown >= steps.length} onClick={() => setShown((n) => Math.min(steps.length, n + 1))}>Step →</Button>
          <span style={{ fontSize: "0.8rem", color: "var(--zen-color-muted-fg)" }}>{shown}/{steps.length}</span>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} style={{ maxWidth: "100%", height: "auto" }} role="group" aria-label={title ?? "Sequence diagram"}>
          <defs>
            <marker id="seq-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="var(--zen-color-primary)" />
            </marker>
          </defs>
          {/* actor headers + lifelines */}
          {actors.map((a, i) => (
            <g key={i}>
              <rect x={colW * i + 12} y={2} width={colW - 24} height={topH - 12} rx={6} fill="var(--zen-color-muted)" stroke="var(--zen-color-border)" />
              <text x={colX(i)} y={topH - 16} textAnchor="middle" fill="var(--zen-color-primary-soft-fg)" fontSize="13" fontFamily="var(--font-mono)">{a}</text>
              <line x1={colX(i)} y1={topH} x2={colX(i)} y2={H - pad} stroke="var(--zen-color-border)" strokeDasharray="3 3" />
            </g>
          ))}
          {/* messages */}
          {steps.map((s, i) => {
            const visible = i < shown;
            const current = i === shown - 1;
            const fi = actors.indexOf(s.from);
            const ti = actors.indexOf(s.to);
            const y = topH + i * stepH + 24;
            const x1 = colX(fi);
            const x2 = colX(ti);
            const dir = x2 >= x1 ? 1 : -1;
            return (
              <g key={i} opacity={visible ? 1 : 0.18}>
                <line x1={x1} y1={y} x2={x2 - dir * 6} y2={y} stroke="var(--zen-color-primary)" strokeWidth={current ? 2.5 : 1.5} markerEnd="url(#seq-arrow)" />
                <text
                  x={(x1 + x2) / 2}
                  y={y - 7}
                  textAnchor="middle"
                  fill={current ? "var(--zen-color-primary)" : "var(--zen-color-foreground)"}
                  fontSize="12"
                  fontFamily="var(--font-mono)"
                >
                  {s.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
