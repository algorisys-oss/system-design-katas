import { useState } from "react";
import { Button, Badge } from "@algorisys/zen-ui-react";

export interface StepperStep {
  title: string;
  body: string;
}

export interface StepperProps {
  title?: string;
  steps: StepperStep[];
}

// Step-through walkthrough: the reader advances one stage at a time so a process
// (a request path, a fetch-decode-execute loop) lands sequentially, not all at once.
export function StepperWalkthrough({ title, steps }: StepperProps) {
  const [i, setI] = useState(0);
  const step = steps[i];
  const atStart = i === 0;
  const atEnd = i === steps.length - 1;

  return (
    <div className="interaction">
      {title && <div className="prompt">{title}</div>}
      <Badge variant="soft" color="primary">
        Step {i + 1} of {steps.length}
      </Badge>
      <div className="step-body">
        <strong>{step.title}</strong>
        <p style={{ margin: "0.35rem 0 0" }}>{step.body}</p>
      </div>
      <div className="step-controls">
        <Button
          variant="outline"
          color="neutral"
          disabled={atStart}
          onClick={() => setI((n) => Math.max(0, n - 1))}
        >
          ← Prev
        </Button>
        <Button
          color="primary"
          disabled={atEnd}
          onClick={() => setI((n) => Math.min(steps.length - 1, n + 1))}
        >
          Next →
        </Button>
      </div>
    </div>
  );
}
