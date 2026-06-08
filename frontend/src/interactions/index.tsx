import type { ComponentType } from "react";
import { Quiz } from "./quiz";
import { Reveal } from "./reveal";
import { StepperWalkthrough } from "./stepper";
import { Match } from "./match";
import { Compare } from "./compare";
import { Calc } from "./calc";
import { Tradeoff } from "./tradeoff";
import { Flashcards } from "./flashcards";

// Registry mapping a fenced-block language (```quiz, ```reveal, ```stepper …)
// to its interaction component. The markdown renderer parses the JSON body and
// spreads it as props. Add new interactions here (see meta/style-guide.md).
//
// Implemented: quiz, reveal, stepper, match, compare, calc, tradeoff, flashcards.
export const INTERACTIONS: Record<string, ComponentType<any>> = {
  quiz: Quiz,
  reveal: Reveal,
  stepper: StepperWalkthrough,
  match: Match,
  compare: Compare,
  calc: Calc,
  tradeoff: Tradeoff,
  flashcards: Flashcards,
};

export function isInteraction(lang: string | undefined): boolean {
  return !!lang && lang in INTERACTIONS;
}
