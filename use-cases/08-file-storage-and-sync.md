---
title: "Design a File Storage & Sync Service (Dropbox/Drive)"
slug: file-storage-and-sync
level: use-cases
module: large-scale-systems
order: 8
reading_time_min: 20
concepts: [content-addressed-storage, file-chunking, delta-sync, merkle-trees, blob-object-store, conflict-resolution]
use_cases: [file-storage-and-sync]
prerequisites: [where-your-data-lives, merkle-trees, consistency-models, cdn, database-sharding]
status: published
---

# Design a File Storage & Sync Service (Dropbox/Drive)

> **Use case:** store a user's files in the cloud and keep them **identical across all their devices**
> (laptop, phone, web), so an edit on one device shows up everywhere — with sensible behavior when two
> devices change the same file at once.
> **Domain:** Dropbox, Google Drive, OneDrive, iCloud Drive, Box.
> **Scale:** hundreds of millions of users, exabytes of stored bytes, but most uploads are **small deltas
> to files that already exist** — so the design lives or dies on **not moving bytes you don't have to**.
> **Core challenges:** **chunking** large files, **content-addressed deduplication** (hash/Merkle),
> separating a **metadata DB** from a **blob object store**, a **sync engine** with **delta sync**,
> **conflict resolution** on concurrent edits, **sharing & permissions**, and a **CDN** for downloads.

This design is a masterclass in one idea: **a file is not bytes, it's a list of content hashes.** Once
you accept that, dedup, delta sync, and integrity all fall out of the same mechanism.

## 1 · Clarify requirements

**Functional**
- Upload/download files of any size; preserve a directory tree.
- **Sync:** a change on one device propagates to that user's other devices automatically.
- **Delta sync:** editing 1 MB of a 1 GB file uploads ~1 MB, not 1 GB.
- **Sharing:** share a file/folder with other users or via link; manage **permissions** (view/edit).
- **Versions:** keep file history so a user can restore an earlier version.

**Non-functional**
- **Durability above all:** never lose a byte (target ~11 nines, like S3). Files are irreplaceable.
- **Storage-efficient:** deduplicate identical content across users and versions.
- **Fast sync:** detect and propagate changes within seconds; downloads served from near the user.
- **Offline-tolerant:** a device may edit while offline and reconcile on reconnect → **conflicts happen.**

```reveal
{
  "prompt": "Why is 'upload only the changed bytes' (delta sync) the requirement that shapes the whole architecture, more than raw storage size?",
  "answer": "Storing exabytes is a solved problem — you rent an object store (S3/GCS) that scales horizontally and gives you ~11 nines of durability for cheap. The hard, differentiating problem is bandwidth and latency on the sync path. Most real activity is small edits to existing files: someone changes a paragraph in a 40 MB presentation, or appends a row to a spreadsheet. If every save re-uploaded the whole file, a user on a slow connection would wait minutes per save and you'd waste enormous upload bandwidth and storage. Delta sync — upload only the chunks that changed — is what makes the product feel instant and keeps costs sane. But delta sync requires you to first split files into chunks and identify each chunk by its content hash, so client and server can compare 'which chunks do you already have?' without transferring the bytes. That single decision (content-addressed chunks) then also gives you deduplication (identical chunks stored once globally) and integrity verification (the hash IS the checksum) for free. So the bandwidth requirement, not the storage requirement, is what forces chunking + content addressing, which is the backbone of the entire system."
}
```

## 2 · Estimate the scale

```calc
{
  "title": "Daily upload throughput (before dedup)",
  "inputs": [
    { "key": "users", "label": "Daily active users (millions)", "default": 100 },
    { "key": "filesPerUser", "label": "File saves per user/day", "default": 20 },
    { "key": "avgUploadMB", "label": "Avg bytes uploaded per save (MB, post-delta)", "default": 2 }
  ],
  "formula": "users * 1000000 * filesPerUser * avgUploadMB / 86400",
  "resultLabel": "Average upload throughput",
  "resultUnit": "MB/s"
}
```

```calc
{
  "title": "Metadata DB rows for chunk references",
  "inputs": [
    { "key": "files", "label": "Total files stored (billions)", "default": 50 },
    { "key": "chunksPerFile", "label": "Avg chunks per file", "default": 4 }
  ],
  "formula": "files * 1000000000 * chunksPerFile",
  "resultLabel": "File-to-chunk reference rows",
  "resultUnit": "rows"
}
```

> Even with delta sync, ~tens of GB/s of uploads and **hundreds of billions of metadata rows**. Two
> takeaways: (1) the **metadata DB must be sharded** (by user/namespace), and (2) the actual bytes belong
> in a **blob object store**, not the database — the DB only stores small **pointers to content hashes**.

## 3 · Data model & API

Split state into two stores that scale independently:

- **Blob object store** (S3/GCS/Azure Blob): the actual chunk bytes, keyed by their **content hash**
  (e.g. `blobs/<sha256>`). Immutable, deduplicated, append-only.
- **Metadata DB** (sharded SQL or a strongly-consistent store): the file tree, versions, permissions,
  and — crucially — each file's **ordered list of chunk hashes** (its "recipe").

```
PUT  /files/{path}        body: manifest = [chunkHash, ...]   (after chunks are uploaded)
POST /chunks/check        body: [hash,...] -> { missing: [hash,...] }   (which to upload)
PUT  /chunks/{hash}       body: chunk bytes   (only for missing hashes)
GET  /files/{path}        -> manifest + signed CDN URLs per chunk
GET  /changes?cursor=...  -> list of namespace changes since cursor (sync delta)
```

The order matters: the client **asks which chunks are missing first**, uploads only those, then commits
the manifest. A file's content is fully described by its manifest — a list of hashes.

## 4 · High-level architecture

```flow
{
  "title": "Upload path (content-addressed, dedup-aware)",
  "nodes": [
    { "label": "Client (chunker)", "detail": "Splits file into chunks, hashes each (SHA-256), builds a manifest of hashes." },
    { "label": "Chunk-check API", "detail": "Client sends the hash list; server returns only the hashes it does NOT already have." },
    { "label": "Blob object store", "detail": "Client uploads ONLY missing chunks, keyed by hash. Identical chunks are never stored twice." },
    { "label": "Metadata DB", "detail": "Server commits the manifest (file path -> ordered chunk hashes) + new version + bumps the namespace cursor." },
    { "label": "Notification service", "detail": "Pushes 'namespace changed' to the user's other online devices, which then pull the delta." }
  ],
  "note": "The bytes go to the blob store; the small manifest of hashes goes to the DB. Most uploads transfer few or zero chunks."
}
```

**Storage split rationale (recall where-your-data-lives):** the object store is built for huge, immutable
blobs with extreme durability and cheap-per-GB pricing but no rich queries; the metadata DB is built for
small, mutable, queryable records (list a folder, check a permission) but is expensive per GB. Putting
bytes in the DB would be slow and ruinously costly; putting the file tree in the object store would make
"list this folder" impossible. Each store does what it's good at.

## 5 · Deep dive — chunking, content addressing, and delta sync

### 5a · How do we split a file into chunks?

Two strategies, and the choice quietly determines how good your dedup and delta sync are:

```compare
{
  "options": [
    { "label": "Fixed-size chunks", "points": ["Split every N bytes (e.g. 4 MB)", "Trivial to implement", "Boundary-shift problem: insert 1 byte at the start and EVERY chunk's content shifts, so every hash changes", "Poor dedup/delta for inserts"] },
    { "label": "Content-defined chunking (CDC)", "points": ["A rolling hash (e.g. Rabin) sets boundaries where the data hash hits a pattern", "Boundaries move WITH the content, so an insert only changes the one chunk it lands in", "Variable chunk sizes (target ~4 MB)", "Excellent dedup/delta — what real systems use"] }
  ]
}
```

```reveal
{
  "prompt": "Why does content-defined chunking dedup far better than fixed-size chunking when a user inserts bytes near the start of a file?",
  "answer": "With fixed-size chunking, chunk boundaries are at byte offsets 0, 4MB, 8MB, … Insert one byte at the front and every subsequent byte shifts forward by one position, so chunk 1 now holds bytes 1–4MB+1, chunk 2 holds different bytes than before, and so on — every chunk's content changed, so every hash changed, so delta sync re-uploads the whole file and dedup finds nothing. Content-defined chunking sets boundaries based on the data itself: a rolling hash slides over the bytes, and wherever the hash matches a chosen pattern (e.g. low bits all zero) you cut a boundary. Because boundaries are anchored to content patterns, not absolute offsets, inserting a byte near the front only disturbs the chunk that contains the insertion point — the rolling hash re-synchronizes at the next natural boundary, and all later chunks have the exact same content and hashes as before. So only one (or two) chunks are 'new'; the rest are recognized as already stored. This is why backup and sync systems (restic, borg, and rsync's delta algorithm) use rolling-hash CDC: it makes dedup and delta sync robust to insertions and deletions, not just overwrites. (Dropbox, by contrast, is documented as storing fixed ~4 MB blocks keyed by SHA-256 rather than content-defined chunks.)"
}
```

### 5b · Content addressing and Merkle integrity

Each chunk's name **is** its SHA-256 hash. This gives three properties at once:

- **Deduplication:** two users who upload the same PDF produce the same chunk hashes → stored once.
- **Integrity:** to verify a downloaded chunk, re-hash it; if it doesn't match its name, it's corrupt
  (the hash is a built-in checksum — recall merkle-trees).
- **Cheap comparison:** a file's identity is the hash of its manifest (a **Merkle root** over its chunks).
  Two devices compare one root hash to know instantly whether a file matches; if not, they walk down to
  find exactly which chunks differ — without transferring any data.

A folder, in turn, hashes the hashes of its files — a **Merkle tree** over the whole namespace. Comparing
two trees touches only the branches that changed, which is how sync figures out *what* changed with
minimal work.

### 5c · The sync engine

```sequence
{
  "title": "An edit on Laptop syncs to Phone (delta sync)",
  "actors": ["Laptop", "ChunkAPI", "BlobStore", "MetaDB", "Notifier", "Phone"],
  "steps": [
    { "from": "Laptop", "to": "Laptop", "label": "watch FS, detect change, re-chunk file, hash chunks" },
    { "from": "Laptop", "to": "ChunkAPI", "label": "POST /chunks/check [h1,h2,h3] -> missing: [h2]" },
    { "from": "Laptop", "to": "BlobStore", "label": "PUT only chunk h2" },
    { "from": "Laptop", "to": "MetaDB", "label": "commit manifest [h1,h2,h3], new version, bump cursor" },
    { "from": "MetaDB", "to": "Notifier", "label": "namespace N changed (cursor=C+1)" },
    { "from": "Notifier", "to": "Phone", "label": "push: pull changes since your cursor" },
    { "from": "Phone", "to": "MetaDB", "label": "GET /changes?cursor -> manifest now [h1,h2,h3]" },
    { "from": "Phone", "to": "BlobStore", "label": "fetch only chunk h2 (already has h1,h3)" }
  ]
}
```

Each device tracks a **cursor** (a monotonic version of its namespace, like a journal position). On
reconnect it asks "what changed since cursor C?" and gets a compact delta — it never re-scans everything.
Online devices are nudged by a lightweight **notification service** (long-poll/WebSocket) so they pull
promptly; offline ones catch up via the cursor when they return.

### 5d · Conflict resolution

When two devices edit the same file concurrently (common after offline work), there is **no single right
answer** — recall consistency-models: you can't have strong consistency and offline availability at once.

```compare
{
  "options": [
    { "label": "Last-writer-wins (LWW)", "points": ["Keep the newest write by timestamp/version", "Simple, no user friction", "Silently DISCARDS the other edit — data loss", "OK for fields that don't matter (e.g. last-opened time)"] },
    { "label": "Conflicted copy (Dropbox style)", "points": ["Detect divergent versions from a common ancestor", "Keep both: 'file.docx' and 'file (user's conflicted copy).docx'", "No data lost; user resolves manually", "What general file sync uses for opaque binaries"] },
    { "label": "Operational merge (CRDT/OT)", "points": ["Merge concurrent edits at the operation level", "No conflict copy for collaborative docs (Google Docs)", "Only works when the app understands the file format", "Complex; not possible for arbitrary binary files"] }
  ]
}
```

```reveal
{
  "prompt": "Why does general file sync (Dropbox/Drive) make a 'conflicted copy' instead of auto-merging, while Google Docs merges live edits seamlessly?",
  "answer": "It comes down to whether the system understands the file's contents. Google Docs controls the document format and represents every edit as an operation (insert char at position, delete range, etc.). With operational transformation or CRDTs, two concurrent operations can be transformed against each other into a single consistent result — so two people typing in the same paragraph merge automatically with no data loss. General file sync, by contrast, stores opaque blobs: a .docx, .psd, .sqlite, or .zip is just bytes to the sync engine, which has no idea how to merge two divergent versions of a binary without corrupting it. Picking one and discarding the other (LWW) would silently lose someone's work — unacceptable for files people care about. So the safe, format-agnostic choice is conflict detection plus a conflicted copy: the engine notices that both devices changed a file from the same base version (their version vectors diverged), keeps both versions under different names ('Budget (Alex's conflicted copy).xlsx'), and lets the human decide. It trades a little user friction for a guarantee that no edit is ever silently lost — the right default when you can't understand the data. Operational merge is strictly better when you DO understand the format, which is exactly why collaborative editors implement it and generic file sync cannot."
}
```

How does the engine even know two versions conflict rather than one being newer? Each file version carries
a **version vector** (a per-device counter, recall consistency-models). If device B's new version was based
on a version that already includes device A's change, A's edit is an ancestor → no conflict, just apply.
If neither version descends from the other, they **diverged concurrently** → conflict.

```tradeoff
{
  "title": "Concurrent-edit policy: how much do you trust automatic resolution?",
  "axis": { "left": "Never lose data (manual)", "right": "Never bother the user (automatic)" },
  "steps": [
    { "label": "Conflicted copy", "detail": "Keep both versions side by side; user resolves. Zero data loss, some friction. The safe default for opaque files." },
    { "label": "Version vectors + prompt", "detail": "Detect true concurrency, surface only real conflicts, let the user pick or merge. Less noise than copying on every overlap." },
    { "label": "Operational merge (CRDT/OT)", "detail": "Auto-merge concurrent edits at the operation level. Seamless for collaborative docs, but only when the app understands the format." },
    { "label": "Last-writer-wins", "detail": "Keep the newest write, drop the rest. Frictionless but silently loses edits — only acceptable for unimportant fields." }
  ]
}
```

### 5e · Sharing, permissions, and CDN downloads

- **Sharing & permissions:** sharing a folder grants another user (or a link) a role (viewer/editor) on a
  namespace subtree. The metadata DB stores an **access-control list** per file/folder; a download first
  checks "may this user read this path?" before issuing chunk URLs. Because chunks are content-addressed
  and shared, the same blob can back many users' files — so **permission is enforced on the metadata path,
  never by hiding the blob** (anyone with the hash must not be able to read it, so blob access is via
  short-lived **signed URLs**, not public links).
- **CDN for downloads:** popular shared files (a viral PDF, a team's logo) would hammer the object store
  and be slow for distant users. Put a **CDN** (recall cdn) in front: chunks are immutable and named by
  hash, which makes them **perfectly cacheable** (the hash is the cache key; content never changes under a
  key). The first download warms the edge; everyone nearby is then served locally. Access stays controlled
  via signed URLs with short expiry.

## 6 · Trade-offs & failure modes

- **Metadata/blob can drift.** You commit the manifest (DB) and upload chunks (blob store) in two systems
  — if one half fails, you get a manifest pointing at a missing chunk, or orphan chunks no manifest
  references. **Fix:** upload chunks *first*, commit the manifest *last* (a manifest is only valid once all
  its chunks exist); a background **garbage collector** reference-counts chunks and deletes unreferenced
  ones (carefully — a chunk may be shared by many files/users).
- **Dedup vs privacy/security.** Global cross-user dedup is storage-efficient but enables a side channel:
  if uploads finish instantly, an attacker learns the file already exists (someone else has it). Some
  systems dedup only per-user, or add per-user encryption, trading storage for privacy.
- **Small-file overhead.** Chunking shines for big files; millions of tiny files make metadata, not bytes,
  the bottleneck — the DB row and manifest can dwarf the content. Pack tiny files or skip chunking below a
  threshold.
- **Hot shared file.** A widely shared file concentrates reads; the CDN absorbs most, but cache misses and
  permission checks still funnel to one metadata shard — a hot-partition risk (recall database-sharding).
- **Notification fan-out.** A user with many devices, or a big shared folder, means one change notifies
  many clients; the notifier must be cheap (just "pull since cursor"), never push the data itself.

## 7 · Scaling & evolution

- **Shard the metadata DB by namespace** (recall database-sharding): all of a user's (or shared folder's)
  files live on one shard so "list folder" and version-vector checks are single-shard, while users spread
  across shards. The blob store scales on its own (it's just hash → bytes).
- **Tiered storage:** move cold versions/old chunks to cheaper, slower storage (S3 Glacier-class) and keep
  hot chunks on fast tiers; the manifest doesn't change, only where the bytes live.
- **Block-level delta within a chunk:** for huge files, combine CDC with rsync-style rolling-checksum
  diffs so even sub-chunk edits transfer minimally.
- **Geo-replication:** replicate blobs and metadata across regions for durability and to serve sync near
  the user; reconcile with version vectors.
- **Client-side encryption:** encrypt chunks before upload (zero-knowledge); note this kills cross-user
  dedup unless you use convergent encryption (encrypt with a key derived from the content hash).

## Self-test

```quiz
{
  "question": "A user inserts one byte at the start of a 1 GB file and saves. With content-defined (rolling-hash) chunking, roughly how much is re-uploaded?",
  "options": ["The whole 1 GB (all chunk hashes change)", "About one chunk (~4 MB) — only the chunk containing the insertion changes", "Exactly one byte", "Half the file"],
  "answer": 1,
  "explanation": "CDC anchors boundaries to content, so after the disturbed chunk the rolling hash re-synchronizes and later chunks keep identical hashes. Fixed-size chunking would shift every boundary and re-upload everything."
}
```

```quiz
{
  "question": "Why store the actual file bytes in a blob object store but the list of chunk hashes in the metadata DB?",
  "options": [
    "The database is faster for large blobs",
    "Each store does what it's good at: object store = cheap, durable, immutable big blobs; DB = small, queryable, mutable records like the file tree and permissions",
    "Object stores can't store hashes",
    "To avoid using a CDN"
  ],
  "answer": 1,
  "explanation": "Bytes in the DB would be slow and costly; the file tree in the object store would make folder listing and permission checks impossible. Split by what each storage type is built for."
}
```

```quiz
{
  "question": "Two offline devices edit the same .xlsx from the same base version, then both come online. What does a general file-sync service typically do?",
  "options": [
    "Auto-merge the spreadsheets cell by cell",
    "Keep the newest by timestamp and silently drop the other",
    "Detect the divergence via version vectors and keep both as a 'conflicted copy' so no edit is lost",
    "Refuse to sync either version"
  ],
  "answer": 2,
  "explanation": "The engine can't safely merge opaque binary formats, so it keeps both versions and lets the user resolve. Operational merge (Google Docs) is only possible when the app understands the format."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{
  "title": "File storage & sync — key terms",
  "cards": [
    { "front": "Content-defined chunking (CDC)", "back": "Split a file at boundaries set by a rolling hash over the data, so an insert disturbs only one chunk — robust dedup and delta sync (vs fixed-size, where one insert shifts every boundary)." },
    { "front": "Content-addressed storage", "back": "Store/name each chunk by the hash of its bytes. Gives dedup (identical content stored once), integrity (the hash is a checksum), and cheap comparison for free." },
    { "front": "Manifest / Merkle root", "back": "A file = an ordered list of chunk hashes; hashing that list yields the file's identity. Devices compare one root to know if files match, then drill down to find differing chunks." },
    { "front": "Delta sync", "back": "Upload/download only the chunks that changed (found via chunk-check on hashes), not the whole file — the core of efficient sync." },
    { "front": "Version vector", "back": "Per-device counters attached to each version; lets the engine tell a true concurrent conflict (neither descends from the other) from a simple newer edit." },
    { "front": "Conflicted copy", "back": "When concurrent edits to an opaque file diverge, keep BOTH versions under different names so no edit is silently lost — format-agnostic conflict resolution." }
  ]
}
```

## Key takeaways

- **A file is a list of content hashes.** Chunk it, hash each chunk, and name chunks by their hash — that
  one decision delivers **deduplication, delta sync, and integrity** from the same mechanism.
- **Use content-defined (rolling-hash) chunking**, not fixed-size, so inserts don't reshuffle every chunk;
  compare files via **Merkle roots** to find exactly what changed without moving bytes.
- **Split storage:** bytes in a **blob object store** (cheap, immutable, ~11 nines durable), pointers and
  the file tree in a **sharded metadata DB** (queryable, mutable) — each store doing what it's good at.
- **Conflicts are unavoidable** with offline edits; for opaque files use **version vectors + conflicted
  copies** (never silently lose data), and reserve **operational merge (CRDT/OT)** for formats you control.
- **Permissions on the metadata path, immutable chunks behind a CDN** with **signed URLs** — hash-named
  chunks are perfectly cacheable, so downloads scale globally while access stays controlled.

## Concepts exercised

This design applies, end to end: `where-your-data-lives` (the blob-store vs metadata-DB split is the whole
storage strategy) · `merkle-trees` (content-addressed chunks, manifests as Merkle roots, comparing trees to
find changes) · `consistency-models` (version vectors, concurrent-edit detection, and the offline
availability-vs-consistency trade-off behind conflicted copies) · `cdn` (serving immutable hash-named
chunks from the edge with signed URLs) · `database-sharding` (sharding metadata by namespace, and the
hot-shared-file hot-partition risk). It also touches deduplication, garbage collection / reference
counting, and convergent encryption for privacy-preserving dedup.
