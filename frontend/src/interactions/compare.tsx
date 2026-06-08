import { Tabs, TabsList, TabsTrigger, TabsContent } from "@algorisys/zen-ui-react";

interface CompareOption {
  label: string;
  points: string[];
}

export interface CompareProps {
  options: CompareOption[];
}

// Side-by-side option comparison as tabs. Teaches by making the reader flip
// between alternatives (TCP vs UDP, RAM vs Storage) rather than scan a table.
export function Compare({ options }: CompareProps) {
  return (
    <div className="interaction">
      <Tabs defaultValue="0">
        <TabsList>
          {options.map((o, i) => (
            <TabsTrigger key={i} value={String(i)}>
              {o.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {options.map((o, i) => (
          <TabsContent key={i} value={String(i)}>
            <ul style={{ margin: "0.75rem 0 0", paddingLeft: "1.2rem" }}>
              {o.points.map((p, j) => (
                <li key={j}>{p}</li>
              ))}
            </ul>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
