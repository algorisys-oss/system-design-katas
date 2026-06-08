import { useState } from "react";
import { Button } from "@algorisys/zen-ui-react";

interface Card {
  front: string;
  back: string;
}

export interface FlashcardsProps {
  title?: string;
  cards: Card[];
}

// A flashcard deck: read the prompt (front), commit to an answer, flip to check
// (back), then move through the deck. Spaced active-recall practice for a
// chapter's key terms/ideas — click the card or "Flip", navigate with Prev/Next.
export function Flashcards({ title, cards }: FlashcardsProps) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  if (!cards?.length) return null;

  const total = cards.length;
  const card = cards[i];
  const go = (next: number) => {
    setFlipped(false);
    setI(next);
  };

  return (
    <div className="interaction flashcards">
      {title && <div className="prompt">{title}</div>}

      <button
        type="button"
        className={`flashcard${flipped ? " flipped" : ""}`}
        onClick={() => setFlipped((f) => !f)}
        aria-pressed={flipped}
        aria-label={flipped ? "Showing answer — click to show prompt" : "Showing prompt — click to reveal answer"}
      >
        <span className="flashcard-face-label">{flipped ? "answer" : "prompt"}</span>
        <span className="flashcard-text">{flipped ? card.back : card.front}</span>
        {!flipped && <span className="flashcard-hint">click to flip</span>}
      </button>

      <div className="flashcards-controls">
        <Button
          variant="outline"
          size="sm"
          disabled={i === 0}
          onClick={() => go(i - 1)}
        >
          ← Prev
        </Button>
        <span className="flashcards-count">
          {i + 1} / {total}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={i === total - 1}
          onClick={() => go(i + 1)}
        >
          Next →
        </Button>
      </div>
    </div>
  );
}
