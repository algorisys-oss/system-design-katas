import { useState } from "react";

interface Node {
  label: string;
  detail?: string;
}

export interface FlowProps {
  title?: string;
  nodes: (string | Node)[];
  note?: string;
}

function norm(n: string | Node): Node {
  return typeof n === "string" ? { label: n } : n;
}

// Horizontal boxes-and-arrows flow (e.g. a request path). Nodes are
// keyboard-focusable; selecting one shows its detail. Themed SVG; scrolls
// horizontally on narrow screens.
export function Flow({ title, nodes, note }: FlowProps) {
  const items = nodes.map(norm);
  const [sel, setSel] = useState<number | null>(null);

  const boxW = 130;
  const boxH = 52;
  const gap = 46; // space for the arrow
  const pad = 6;
  const W = items.length * boxW + (items.length - 1) * gap + pad * 2;
  const H = boxH + pad * 2;
  const cy = pad + boxH / 2;

  return (
    <div className="interaction">
      {title && <div className="prompt">{title}</div>}
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} style={{ maxWidth: "100%", height: "auto" }} role="group" aria-label={title ?? "Flow"}>
          <defs>
            <marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="var(--zen-color-muted-fg)" />
            </marker>
          </defs>
          {items.map((node, i) => {
            const x = pad + i * (boxW + gap);
            const active = i === sel;
            return (
              <g key={i}>
                {i > 0 && (
                  <line
                    x1={x - gap + 4}
                    y1={cy}
                    x2={x - 4}
                    y2={cy}
                    stroke="var(--zen-color-muted-fg)"
                    strokeWidth="1.5"
                    markerEnd="url(#flow-arrow)"
                  />
                )}
                <g
                  tabIndex={0}
                  role="button"
                  aria-pressed={active}
                  onClick={() => setSel(i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(i); }
                  }}
                  style={{ cursor: node.detail ? "pointer" : "default", outline: "none" }}
                >
                  <rect
                    x={x}
                    y={pad}
                    width={boxW}
                    height={boxH}
                    rx={8}
                    fill={active ? "var(--zen-color-primary-soft)" : "var(--zen-color-muted)"}
                    stroke={active ? "var(--zen-color-primary)" : "var(--zen-color-border)"}
                    strokeWidth={active ? 2 : 1}
                  />
                  <text x={x + boxW / 2} y={cy + 5} textAnchor="middle" fill="var(--zen-color-foreground)" fontSize="14" fontFamily="var(--font-mono)">
                    {node.label}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>
      </div>
      {sel !== null && items[sel].detail && (
        <div className="feedback" style={{ color: "var(--zen-color-foreground)" }}>
          <strong style={{ color: "var(--zen-color-primary-soft-fg)" }}>{items[sel].label}</strong> — {items[sel].detail}
        </div>
      )}
      {note && <div className="feedback" style={{ color: "var(--zen-color-muted-fg)" }}>{note}</div>}
    </div>
  );
}
