import { useState } from "react";

interface Node {
  label: string;
  detail?: string;
}

export interface FanoutProps {
  title?: string;
  source: string | Node;
  targets: (string | Node)[]; // parallel siblings, NOT a chain
  sink?: string | Node; // optional fan-in: all targets converge here
  note?: string;
}

function norm(n: string | Node): Node {
  return typeof n === "string" ? { label: n } : n;
}

// One-to-many (and optional many-to-one) topology that the linear `flow`
// renderer can't express: a source box fans out to N PARALLEL target boxes —
// e.g. a load balancer to interchangeable servers, an API gateway to backend
// services, a router to shards. With `sink`, the targets fan back IN to one
// node (e.g. BFFs converging on shared services). Each box is keyboard-
// focusable; selecting it reveals its detail. Themed SVG using --zen-* tokens.
export function Fanout({ title, source, targets, sink, note }: FanoutProps) {
  const src = norm(source);
  const tgts = targets.map(norm);
  const snk = sink ? norm(sink) : undefined;
  const [sel, setSel] = useState<Node | null>(null);

  const pad = 8;
  const boxW = 150;
  const boxH = 46;
  const vGap = 16;
  const colGap = 74; // horizontal space for the arrows

  const blockH = tgts.length * boxH + (tgts.length - 1) * vGap;
  const innerH = Math.max(boxH, blockH);
  const H = innerH + pad * 2;
  const midY = pad + innerH / 2;

  const xSource = pad;
  const xTargets = xSource + boxW + colGap;
  const xSink = xTargets + boxW + colGap;
  const W = (snk ? xSink + boxW : xTargets + boxW) + pad;

  const targetsTop = pad + (innerH - blockH) / 2;
  const targetCy = (i: number) => targetsTop + i * (boxH + vGap) + boxH / 2;

  function Box({ node, x, y }: { node: Node; x: number; y: number }) {
    const active = sel === node;
    return (
      <g
        tabIndex={0}
        role="button"
        aria-pressed={active}
        onClick={() => setSel(node)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(node); }
        }}
        style={{ cursor: node.detail ? "pointer" : "default", outline: "none" }}
      >
        <rect
          x={x}
          y={y}
          width={boxW}
          height={boxH}
          rx={8}
          fill={active ? "var(--zen-color-primary-soft)" : "var(--zen-color-muted)"}
          stroke={active ? "var(--zen-color-primary)" : "var(--zen-color-border)"}
          strokeWidth={active ? 2 : 1}
        />
        <text x={x + boxW / 2} y={y + boxH / 2 + 5} textAnchor="middle" fill="var(--zen-color-foreground)" fontSize="13" fontFamily="var(--font-mono)">
          {node.label}
        </text>
      </g>
    );
  }

  return (
    <div className="interaction">
      {title && <div className="prompt">{title}</div>}
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} style={{ maxWidth: "100%", height: "auto" }} role="group" aria-label={title ?? "Fan-out diagram"}>
          <title>{title ?? "Fan-out"}</title>
          <defs>
            <marker id="fan-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="var(--zen-color-muted-fg)" />
            </marker>
          </defs>
          {/* source -> each target */}
          {tgts.map((_, i) => (
            <line
              key={`s${i}`}
              x1={xSource + boxW}
              y1={midY}
              x2={xTargets - 4}
              y2={targetCy(i)}
              stroke="var(--zen-color-muted-fg)"
              strokeWidth="1.5"
              markerEnd="url(#fan-arrow)"
            />
          ))}
          {/* each target -> sink (fan-in) */}
          {snk && tgts.map((_, i) => (
            <line
              key={`k${i}`}
              x1={xTargets + boxW}
              y1={targetCy(i)}
              x2={xSink - 4}
              y2={midY}
              stroke="var(--zen-color-muted-fg)"
              strokeWidth="1.5"
              markerEnd="url(#fan-arrow)"
            />
          ))}
          <Box node={src} x={xSource} y={midY - boxH / 2} />
          {tgts.map((t, i) => (
            <Box key={i} node={t} x={xTargets} y={targetCy(i) - boxH / 2} />
          ))}
          {snk && <Box node={snk} x={xSink} y={midY - boxH / 2} />}
        </svg>
      </div>
      {sel && sel.detail && (
        <div className="feedback" style={{ color: "var(--zen-color-foreground)" }}>
          <strong style={{ color: "var(--zen-color-primary-soft-fg)" }}>{sel.label}</strong> — {sel.detail}
        </div>
      )}
      {note && <div className="feedback" style={{ color: "var(--zen-color-muted-fg)" }}>{note}</div>}
    </div>
  );
}
