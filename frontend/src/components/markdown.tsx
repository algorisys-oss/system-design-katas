import { isValidElement } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { INTERACTIONS } from "../interactions";
import { DIAGRAMS } from "../diagrams";

// Interaction + diagram fenced blocks resolve through one combined registry.
const WIDGETS = { ...INTERACTIONS, ...DIAGRAMS };
const isWidget = (lang: string | undefined): boolean => !!lang && lang in WIDGETS;

function langOf(className: unknown): string | undefined {
  if (typeof className !== "string") return undefined;
  return /language-(\w+)/.exec(className)?.[1];
}

function renderInteraction(lang: string, raw: string): ReactNode {
  const Comp = WIDGETS[lang];
  try {
    const data = JSON.parse(raw);
    return <Comp {...data} />;
  } catch {
    return (
      <pre className="code-block">
        ⚠ Invalid {lang} block (JSON parse error):{"\n"}
        {raw}
      </pre>
    );
  }
}

// Renders chapter Markdown (GFM tables/code) and turns fenced interaction blocks
// (```quiz, ```reveal, ```stepper …) into live zen-ui components.
export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Unwrap <pre> for interaction blocks so the component renders cleanly.
        pre({ children }) {
          const child = Array.isArray(children) ? children[0] : children;
          if (isValidElement(child)) {
            const lang = langOf((child.props as { className?: string }).className);
            if (isWidget(lang)) return <>{children}</>;
          }
          return <pre className="code-block">{children}</pre>;
        },
        code({ className, children }) {
          const lang = langOf(className);
          if (isWidget(lang)) {
            return renderInteraction(lang!, String(children).trim());
          }
          return <code className={className}>{children}</code>;
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
