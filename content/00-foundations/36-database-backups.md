---
title: "Database Backups"
slug: database-backups
level: foundations
module: database-fundamentals
order: 36
reading_time_min: 13
concepts: [backups, rpo, rto, point-in-time-recovery, replication-vs-backup, restore-testing]
use_cases: []
prerequisites: [database-reads-vs-writes, memory-vs-disk]
status: published
---

# Database Backups

## Hook — a motivating scenario

At 2 a.m. someone runs `DELETE FROM users` without a `WHERE`, or a migration corrupts a table, or
ransomware encrypts the disks. Your replicas don't save you — they faithfully replicated the deletion
in milliseconds. The only thing that brings the data back is a **backup**. Backups are the safety net
nobody thinks about until the night they need it — and the night you discover whether they actually
work.

## Mental model — a time machine, not a spare tire

People confuse two different safety mechanisms:
- **Replication** is a *spare tire*: live copies for **availability** — if one server dies, another
  serves traffic. But replicas copy *everything instantly*, including your mistakes.
- **Backups** are a *time machine*: point-in-time snapshots for **recovery** — they let you go *back*
  to before the bad thing happened.

You need both, for different failures. Replication ≠ backup.

```reveal
{
  "prompt": "If you have three synchronized replicas, why do you still need backups?",
  "answer": "Replicas protect against hardware/node failure (availability), but they replicate logical errors too — an accidental DELETE, a bad migration, corruption, or a malicious/ransomware action is instantly mirrored to every replica. There's no 'undo' in replication. Backups are point-in-time copies you can restore from to recover from mistakes and corruption, not just crashes. They solve a fundamentally different problem than replicas."
}
```

## Build it up — RPO, RTO, and backup types

Two numbers define your recovery goals:
- **RPO (Recovery Point Objective):** how much *data* can you afford to lose? It's the gap between
  backups. Daily backups → up to ~24h of data lost; continuous backups → seconds.
- **RTO (Recovery Time Objective):** how *long* can recovery take? The time to restore and be back
  online.

Smaller RPO/RTO cost more (more frequent backups, faster restore infrastructure). You pick targets
based on how painful loss/downtime is for that data.

```compare
{
  "options": [
    { "label": "Full backup", "points": ["Complete copy of the data", "Simple to restore", "Large + slow to take", "Run periodically (e.g. nightly/weekly)"] },
    { "label": "Incremental + PITR", "points": ["Full + only changes since (logs/WAL)", "Small frequent backups → tiny RPO", "Point-in-time recovery to any moment", "More moving parts to restore"] }
  ]
}
```

**Point-in-time recovery (PITR)** combines a periodic full backup with the continuous transaction log
(WAL) so you can restore to *any* second — e.g. "to 01:59, just before the bad DELETE."

```reveal
{
  "prompt": "What does the 3-2-1 backup rule mean, and what failure does the '1 offsite' copy guard against?",
  "answer": "3-2-1: keep at least 3 copies of the data, on 2 different media/storage types, with 1 copy offsite (e.g. a different region/provider). The offsite copy guards against site-wide disasters — a datacenter fire/flood, a region outage, or an account/ransomware compromise that takes out everything in one place. If all backups sit next to the database, one localized disaster destroys both the data and its backups."
}
```

Backup frequency is a dial: how often you back up sets your RPO, and tighter RPO costs more.

```tradeoff
{
  "title": "How often should you back up (RPO)?",
  "axis": { "left": "Infrequent backups", "right": "Continuous backups" },
  "steps": [
    { "label": "Weekly/daily full", "detail": "Large, simple full copies taken nightly or weekly. Cheapest and simplest, but RPO is up to ~24h — that much data can be lost between backups." },
    { "label": "Full + incremental", "detail": "A periodic full plus small frequent incrementals of only the changes. Smaller RPO at lower cost than full backups, with more moving parts to restore." },
    { "label": "Continuous WAL / PITR", "detail": "Full backup plus the continuous transaction log enables point-in-time recovery to any second — RPO of seconds. Smallest data loss, most infrastructure and cost." }
  ]
}
```

## In the wild

- **Managed databases** (RDS, Cloud SQL) offer automated daily snapshots + continuous WAL archiving
  for PITR, retained for a configurable window.
- **Restore drills are mandatory:** a backup you've never restored is a hope, not a backup. Test
  restores regularly and time them (that's your real RTO).
- **Retention & compliance:** keep backups long enough for legal/audit needs; encrypt them; control
  who can delete them (so ransomware/insiders can't wipe both data and backups).
- **Backups live on cheap, durable storage** (recall tiers) — often a different region for the offsite
  copy.

## Common misconception — "we have backups, so we're safe"

An untested backup is a liability disguised as safety.

```reveal
{
  "prompt": "A company takes nightly backups for two years, then a disaster strikes — and the restore fails. What are the classic reasons, and the lesson?",
  "answer": "Common causes: the backups were silently corrupt or incomplete; a needed table/extension wasn't included; nobody knew the restore procedure (so RTO ballooned during the crisis); the backups were stored next to the data and lost in the same disaster; or restore was never tested at full data size and is far too slow. The lesson: backups only count if you regularly *test the restore*. 'We take backups' is meaningless without proven, timed, periodic restores — recovery is the feature, not the backup file."
}
```

The deliverable isn't a backup file — it's a **proven ability to recover**. Untested backups fail
exactly when you need them. Test restores regularly, measure RTO, and keep an offsite copy.

## Self-test

```quiz
{
  "question": "Why is replication NOT a substitute for backups?",
  "options": [
    "Replication is slower",
    "Replicas instantly copy mistakes/corruption too, with no way to go back in time",
    "Replicas can't store as much data",
    "Backups provide high availability"
  ],
  "answer": 1,
  "explanation": "Replication is for availability and mirrors errors immediately; backups are point-in-time recovery from mistakes/corruption."
}
```

```quiz
{
  "question": "RPO (Recovery Point Objective) measures:",
  "options": [
    "How long recovery takes",
    "How much data you can afford to lose (the gap between backups)",
    "The size of the database",
    "The number of replicas"
  ],
  "answer": 1,
  "explanation": "RPO = acceptable data loss window (backup frequency); RTO = acceptable time to recover."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Database backups — key terms", "cards": [
  { "front": "Replication vs backup", "back": "Replication is live copies for availability and mirrors mistakes instantly; backups are point-in-time copies for recovery from errors, corruption, and disasters. You need both." },
  { "front": "RPO (Recovery Point Objective)", "back": "How much data you can afford to lose — the gap between backups. Daily backups risk ~24h of loss; continuous backups risk only seconds." },
  { "front": "RTO (Recovery Time Objective)", "back": "How long recovery is allowed to take — the time to restore and be back online. Your tested, timed restore is your real RTO." },
  { "front": "Point-in-time recovery (PITR)", "back": "Combines a periodic full backup with the continuous transaction log (WAL) so you can restore to any second, e.g. just before a bad DELETE." },
  { "front": "3-2-1 rule", "back": "Keep at least 3 copies of the data, on 2 different media/storage types, with 1 copy offsite, guarding against site-wide disasters and ransomware." },
  { "front": "Restore drill", "back": "Regularly testing and timing an actual restore. An untested backup is a hope, not a backup — recovery is the deliverable, not the backup file." }
] }
```

## Key takeaways

- **Replication ≠ backup:** replicas give availability and mirror mistakes; backups are point-in-time
  recovery from errors, corruption, and disasters.
- Define **RPO** (acceptable data loss) and **RTO** (acceptable downtime); they drive backup frequency
  and restore infrastructure.
- Use **full + incremental/PITR** for small RPO and any-moment recovery; follow **3-2-1** (incl. an
  offsite copy).
- The real deliverable is a **tested restore** — untested backups fail when it matters; drill and time
  recovery.

## Up next

That completes databases. The fastest read is the one you never make to the database — next module:
**Caching Fundamentals**.
