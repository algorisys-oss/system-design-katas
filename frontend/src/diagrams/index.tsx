import type { ComponentType } from "react";
import { Layers } from "./layers";
import { Ladder } from "./ladder";
import { Flow } from "./flow";
import { Fanout } from "./fanout";
import { Sequence } from "./sequence";
import { Ring } from "./ring";

// Registry mapping a fenced-block language to a diagram component. All diagrams
// are custom themed SVG/React (no Mermaid / external libs) — see plan.md §12.4.
export const DIAGRAMS: Record<string, ComponentType<any>> = {
  layers: Layers,
  ladder: Ladder,
  flow: Flow,
  fanout: Fanout,
  sequence: Sequence,
  ring: Ring,
};

export function isDiagram(lang: string | undefined): boolean {
  return !!lang && lang in DIAGRAMS;
}
