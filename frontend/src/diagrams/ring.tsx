import { useState } from "react";
import { Button, Badge } from "@algorisys/zen-ui-react";

interface Point {
  label: string;
  angle: number; // degrees, 0 = top, clockwise
}

export interface RingProps {
  title?: string;
  servers: Point[];
  keys: Point[];
  addServer?: Point; // optional server the reader can toggle on
}

const PALETTE = [
  "var(--zen-color-primary)",
  "var(--zen-color-info)",
  "var(--zen-color-warning)",
  "var(--zen-color-accent-magenta)",
  "var(--zen-color-accent-purple)",
];

// Consistent-hashing ring. Keys are assigned to the first server clockwise.
// Toggling the extra server in shows that only the keys in its arc move — the
// ~1/N property. Themed SVG.
export function Ring({ title, servers, keys, addServer }: RingProps) {
  const [added, setAdded] = useState(false);
  const cx = 170, cy = 170, R = 120;
  const pos = (angle: number, r = R) => {
    const t = ((angle - 90) * Math.PI) / 180; // 0deg at top
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)] as const;
  };

  const activeServers = added && addServer ? [...servers, addServer] : servers;
  // owner = first server clockwise from the key's angle
  function ownerOf(keyAngle: number, list: Point[]) {
    const sorted = [...list].sort((a, b) => a.angle - b.angle);
    for (const s of sorted) if (s.angle >= keyAngle) return s.label;
    return sorted[0].label; // wrap around
  }
  const colorFor = (label: string) =>
    PALETTE[activeServers.findIndex((s) => s.label === label) % PALETTE.length];

  const movedCount = addServer
    ? keys.filter((k) => ownerOf(k.angle, servers) !== ownerOf(k.angle, activeServers)).length
    : 0;

  return (
    <div className="interaction">
      <div className="topbar">
        <div className="prompt" style={{ margin: 0 }}>{title ?? "Consistent hashing ring"}</div>
        {addServer && (
          <Button
            size="sm"
            variant={added ? "soft" : "outline"}
            color={added ? "success" : "primary"}
            onClick={() => setAdded((a) => !a)}
          >
            {added ? `Remove ${addServer.label}` : `Add ${addServer.label}`}
          </Button>
        )}
      </div>
      <svg viewBox="0 0 340 340" width="100%" style={{ maxWidth: 360, display: "block", margin: "0 auto" }} role="img" aria-label={title ?? "Consistent hashing ring"}>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--zen-color-border)" strokeWidth="2" />
        {/* keys */}
        {keys.map((k, i) => {
          const [x, y] = pos(k.angle, R);
          const owner = ownerOf(k.angle, activeServers);
          const moved =
            added && addServer && ownerOf(k.angle, servers) !== owner;
          return (
            <g key={`k${i}`}>
              <circle cx={x} cy={y} r={moved ? 8 : 6} fill={colorFor(owner)} stroke={moved ? "var(--zen-color-foreground)" : "none"} strokeWidth={moved ? 2 : 0} />
              <text x={pos(k.angle, R - 18)[0]} y={pos(k.angle, R - 18)[1] + 4} textAnchor="middle" fontSize="10" fill="var(--zen-color-muted-fg)" fontFamily="var(--font-mono)">{k.label}</text>
            </g>
          );
        })}
        {/* servers */}
        {activeServers.map((s, i) => {
          const [x, y] = pos(s.angle, R);
          const [lx, ly] = pos(s.angle, R + 22);
          const isNew = added && addServer && s.label === addServer.label;
          return (
            <g key={`s${i}`}>
              <rect x={x - 7} y={y - 7} width={14} height={14} rx={3} fill={colorFor(s.label)} stroke={isNew ? "var(--zen-color-foreground)" : "none"} strokeWidth={isNew ? 2 : 0} transform={`rotate(45 ${x} ${y})`} />
              <text x={lx} y={ly + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill={colorFor(s.label)} fontFamily="var(--font-mono)">{s.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="feedback" style={{ color: "var(--zen-color-muted-fg)" }}>
        {added && addServer
          ? <>Adding <strong style={{ color: "var(--zen-color-success)" }}>{addServer.label}</strong> moved only <Badge variant="soft" color="success">{movedCount} of {keys.length}</Badge> keys (highlighted) — just its arc. That's the ~1/N property.</>
          : <>Each key belongs to the first server clockwise. {addServer ? "Toggle the extra server to see how few keys move." : ""}</>}
      </div>
    </div>
  );
}
