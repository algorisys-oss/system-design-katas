import { useMemo, useState } from "react";
import { Button, Badge } from "@algorisys/zen-ui-react";

interface Pair {
  left: string;
  right: string;
}

export interface MatchProps {
  prompt: string;
  pairs: Pair[];
}

// Click-to-match: pick a left item, then its matching right item. Correct pairs
// lock in green; wrong picks flash. Teaches by forcing an active association
// instead of passively reading a table. (No drag dependency needed.)
export function Match({ prompt, pairs }: MatchProps) {
  // Scramble the right column once so it isn't pre-aligned with the left.
  const rights = useMemo(
    () => pairs.map((p, i) => ({ text: p.right, origin: i })).reverse(),
    [pairs],
  );

  const [selected, setSelected] = useState<number | null>(null);
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [wrong, setWrong] = useState<number | null>(null);

  const allDone = matched.size === pairs.length;

  function pickRight(origin: number) {
    if (selected === null || matched.has(selected)) return;
    if (origin === selected) {
      setMatched((m) => new Set(m).add(selected));
      setSelected(null);
      setWrong(null);
    } else {
      setWrong(origin);
      setTimeout(() => setWrong(null), 400);
    }
  }

  return (
    <div className="interaction">
      <div className="prompt">{prompt}</div>
      <div className="match-grid">
        <div className="match-col">
          {pairs.map((p, i) => {
            const done = matched.has(i);
            return (
              <Button
                key={i}
                variant={done ? "soft" : selected === i ? "solid" : "outline"}
                color={done ? "success" : "primary"}
                disabled={done}
                onClick={() => setSelected(i)}
                shape="block"
                multiline
              >
                {p.left}
              </Button>
            );
          })}
        </div>
        <div className="match-col">
          {rights.map((r) => {
            const done = matched.has(r.origin);
            return (
              <Button
                key={r.origin}
                variant={done ? "soft" : "outline"}
                color={done ? "success" : wrong === r.origin ? "error" : "neutral"}
                disabled={done}
                onClick={() => pickRight(r.origin)}
                shape="block"
                multiline
              >
                {r.text}
              </Button>
            );
          })}
        </div>
      </div>
      {allDone && (
        <div className="feedback correct">✓ All matched. Nicely done.</div>
      )}
      {!allDone && selected !== null && (
        <Badge variant="soft" color="info" style={{ marginTop: "0.75rem" }}>
          Now pick the match for “{pairs[selected].left}”
        </Badge>
      )}
    </div>
  );
}
