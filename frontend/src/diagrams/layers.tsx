import { useState } from "react";

interface Layer {
  label: string;
  detail: string;
  meta?: string; // small right-aligned annotation, e.g. "~1 ns"
}

export interface LayersProps {
  title?: string;
  layers: Layer[]; // top = first
}

// A themed stacked-layers diagram (e.g. a memory hierarchy / pyramid). Each
// layer is keyboard-focusable; selecting one reveals its detail below. Drawn in
// SVG using currentColor + --zen-* tokens so it re-themes for free.
export function Layers({ title, layers }: LayersProps) {
  const [sel, setSel] = useState(0);
  const n = layers.length;
  const rowH = 46;
  const gap = 8;
  const W = 520;
  const H = n * rowH + (n - 1) * gap;

  return (
    <div className="interaction">
      {title && <div className="prompt">{title}</div>}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="group"
        aria-label={title ?? "Layers diagram"}
        style={{ maxWidth: W, display: "block", margin: "0 auto" }}
      >
        <title>{title ?? "Layers"}</title>
        {layers.map((l, i) => {
          // Narrow at the top, wide at the bottom — pyramid feel.
          const w = W * (0.45 + (0.55 * i) / Math.max(1, n - 1));
          const x = (W - w) / 2;
          const y = i * (rowH + gap);
          const active = i === sel;
          return (
            <g
              key={i}
              tabIndex={0}
              role="button"
              aria-pressed={active}
              onClick={() => setSel(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSel(i);
                } else if (e.key === "ArrowDown") {
                  setSel((s) => Math.min(n - 1, s + 1));
                } else if (e.key === "ArrowUp") {
                  setSel((s) => Math.max(0, s - 1));
                }
              }}
              style={{ cursor: "pointer", outline: "none" }}
            >
              <rect
                x={x}
                y={y}
                width={w}
                height={rowH}
                rx={6}
                fill={active ? "var(--zen-color-primary-soft)" : "var(--zen-color-muted)"}
                stroke={active ? "var(--zen-color-primary)" : "var(--zen-color-border)"}
                strokeWidth={active ? 2 : 1}
              />
              <text
                x={x + 14}
                y={y + rowH / 2 + 5}
                fill="var(--zen-color-foreground)"
                fontSize="15"
                fontFamily="var(--font-mono)"
              >
                {l.label}
              </text>
              {l.meta && (
                <text
                  x={x + w - 14}
                  y={y + rowH / 2 + 5}
                  textAnchor="end"
                  fill="var(--zen-color-info)"
                  fontSize="13"
                  fontFamily="var(--font-mono)"
                >
                  {l.meta}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="feedback" style={{ color: "var(--zen-color-foreground)" }}>
        <strong style={{ color: "var(--zen-color-primary-soft-fg)" }}>
          {layers[sel].label}
        </strong>{" "}
        — {layers[sel].detail}
      </div>
    </div>
  );
}
