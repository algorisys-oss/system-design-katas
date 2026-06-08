import { Link } from "react-router";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
} from "@algorisys/zen-ui-react";
import type { LevelNode } from "../api/types";
import { useAppStore } from "../store/use-app-store";

const LEVEL_LABELS: Record<string, string> = {
  foundations: "Foundations",
  intermediate: "Intermediate",
  advanced: "Advanced",
  "use-cases": "Use Cases",
};

const MODULE_LABELS: Record<string, string> = {
  "computing-fundamentals": "Computing Fundamentals",
  "networking-fundamentals": "Networking Fundamentals",
  "storage-fundamentals": "Storage Fundamentals",
  "apis-and-the-web": "APIs & the Web",
  "database-fundamentals": "Database Fundamentals",
  "caching-fundamentals": "Caching Fundamentals",
  "foundations-of-system-design": "Foundations of System Design",
  "architecture-and-services": "Architecture & Services",
  "replication-and-partitioning": "Replication & Partitioning",
  "caching-patterns": "Caching Patterns",
  "messaging-and-streaming": "Messaging & Streaming",
  observability: "Observability",
  "reliability-and-testing": "Reliability & Testing",
  "intermediate-capstones": "Capstones",
  "correctness-and-consensus": "Distributed Correctness & Consensus",
  "replication-and-anti-entropy": "Replication & Anti-Entropy",
  "distributed-transactions": "Distributed Transactions & Eventing",
  "storage-internals": "Storage Internals & Data Architecture",
  "global-scale": "Global Scale & Topology",
  resilience: "Resilience & Failure at Scale",
  "operability-and-patterns": "Operability & Architecture Patterns",
  "advanced-capstones": "Capstones",
  "core-building-blocks": "Core Building Blocks",
  "large-scale-systems": "Large-Scale Systems",
  "real-time-and-data-intensive": "Real-Time & Data-Intensive",
  "correctness-and-booking": "Correctness & Booking",
  "ai-systems": "Modern AI Systems",
};

export function Home({ curriculum }: { curriculum: LevelNode[] }) {
  const completed = useAppStore((s) => s.completed);
  const flat = useAppStore((s) => s.flatChapters);

  const total = flat.length;
  const done = flat.filter((c) => completed[c.slug]).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const nextUp = flat.find((c) => !completed[c.slug]) ?? flat[0];
  const started = done > 0;

  return (
    <div className="content">
      <h1>System Design</h1>
      <p>
        A breadth-first, highly interactive path through system design — from the
        building blocks up to distributed patterns. <strong>{total} chapters</strong>,
        each ending with something to <em>do</em>, not just read.
      </p>

      {nextUp && (
        <div className="home-cta">
          <Link to={`/learn/${nextUp.slug}`}>
            <Button color="primary" size="lg">
              {started ? "Continue" : "Start"} → {nextUp.title}
            </Button>
          </Link>
          <div className="home-progress">
            <div className="home-progress-bar">
              <span style={{ width: `${pct}%` }} />
            </div>
            <span className="home-progress-label">
              {done} / {total} complete ({pct}%)
            </span>
          </div>
        </div>
      )}

      {curriculum.map((level) => {
        const lvlChapters = level.modules.flatMap((m) => m.chapters);
        const lvlDone = lvlChapters.filter((c) => completed[c.slug]).length;
        return (
          <section key={level.level} className="home-level">
            <h2 className="home-level-title">
              {LEVEL_LABELS[level.level] ?? level.level}
              <span className="home-level-count">
                {lvlDone}/{lvlChapters.length}
              </span>
            </h2>
            <div className="home-modules">
              {level.modules.map((mod) => {
                const mDone = mod.chapters.filter((c) => completed[c.slug]).length;
                const first = mod.chapters[0];
                return (
                  <Card key={mod.module} className="home-module-card">
                    <CardHeader>
                      <CardTitle>{MODULE_LABELS[mod.module] ?? mod.module}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="home-module-meta">
                        {mDone}/{mod.chapters.length} chapters
                      </div>
                      {first && (
                        <Link to={`/learn/${first.slug}`} className="home-module-link">
                          Open module →
                        </Link>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
