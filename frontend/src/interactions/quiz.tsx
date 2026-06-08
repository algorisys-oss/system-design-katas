import { useState } from "react";
import { Button } from "@algorisys/zen-ui-react";

export interface QuizProps {
  question: string;
  options: string[];
  answer: number;
  explanation?: string;
}

// Multiple-choice with instant feedback. Teaches by letting the reader commit
// to an answer and immediately see whether (and why) it's right.
export function Quiz({ question, options, answer, explanation }: QuizProps) {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;
  const correct = picked === answer;

  return (
    <div className="interaction">
      <div className="prompt">{question}</div>
      <div className="option-row">
        {options.map((opt, i) => {
          const isAnswer = i === answer;
          const isPicked = i === picked;
          const color = answered
            ? isAnswer
              ? "success"
              : isPicked
                ? "error"
                : "neutral"
            : "neutral";
          return (
            <Button
              key={i}
              variant={answered && (isAnswer || isPicked) ? "soft" : "outline"}
              color={color}
              disabled={answered}
              onClick={() => setPicked(i)}
              shape="block"
              multiline
            >
              {opt}
            </Button>
          );
        })}
      </div>
      {answered && (
        <div className={`feedback ${correct ? "correct" : "wrong"}`}>
          {correct ? "✓ Correct. " : "✗ Not quite. "}
          {explanation}
        </div>
      )}
    </div>
  );
}
