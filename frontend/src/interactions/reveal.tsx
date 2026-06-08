import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@algorisys/zen-ui-react";

export interface RevealProps {
  prompt: string;
  answer: string;
}

// Think-then-check: the reader commits to a mental answer before revealing ours.
export function Reveal({ prompt, answer }: RevealProps) {
  return (
    <div className="interaction">
      <Accordion type="single" collapsible>
        <AccordionItem value="reveal">
          <AccordionTrigger>{prompt}</AccordionTrigger>
          <AccordionContent>{answer}</AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
