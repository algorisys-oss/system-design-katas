---
title: "Binary & Data Representation"
slug: binary-and-data-representation
level: foundations
module: computing-fundamentals
order: 1
reading_time_min: 16
concepts: [binary, bits, bytes, encoding, ascii, unicode, integer-overflow, units]
use_cases: []
prerequisites: [how-computers-work]
status: published
---

# Binary & Data Representation

## Hook — a motivating scenario

Your API stores a user's "likes" count as a 32-bit integer. The app goes viral, a celebrity post
sails past **2,147,483,647** likes — and the counter suddenly shows a *negative* number. Nothing
crashed. No error was logged. The number just… wrapped around.

To understand why (and to size databases, caches, and network payloads later), you need to know the
one thing every piece of data in a computer really is: **a pattern of bits**.

## Mental model — everything is light switches

A computer can only physically store one thing: **on or off** — a single **bit** (1 or 0), like a
light switch. Everything else is a *convention* layered on top:

- Group 8 switches → a **byte** (256 possible patterns).
- Agree "this byte means a number" → you have integers.
- Agree "this byte means a letter" → you have text.
- Agree "these 3 bytes mean red/green/blue" → you have a pixel.

The bits don't know what they mean. **Meaning is an agreement** between whoever wrote the data and
whoever reads it. Most bugs in this area are a disagreement about that convention.

## Build it up — from bits to everything

**Counting in binary.** Each bit is a power of two. The byte `0010 1101` is:

```
 128  64  32  16   8   4   2   1
   0   0   1   0   1   1   0   1   =  32 + 8 + 4 + 1  =  45
```

8 bits → 256 values (0–255). Add bits, double the range: 16 bits → 65,536; 32 bits → ~4.3 billion.

```stepper
{
  "title": "Read the byte 0100 0001",
  "steps": [
    { "title": "Place values", "body": "Bits map to 128 64 32 16 | 8 4 2 1." },
    { "title": "Find the 1s", "body": "0100 0001 → the 64 bit and the 1 bit are on." },
    { "title": "Add them", "body": "64 + 1 = 65." },
    { "title": "As text?", "body": "Under the ASCII convention, 65 means the letter 'A'." }
  ]
}
```

**Text.** ASCII assigns 0–127 to English characters (`A`=65, `a`=97, `0`=48). But the world has far
more than 127 characters, so **Unicode** assigns a number ("code point") to every character — over
a million of them — and **UTF-8** encodes those code points into 1–4 bytes. ASCII is a subset of
UTF-8, which is why plain English text "just works" everywhere.

**Why the counter went negative.** A *signed* 32-bit integer spends one bit on the sign, so it holds
−2,147,483,648 … +2,147,483,647. Add 1 to the maximum and the bits roll over to the most-negative
value — **integer overflow**. The fix is using a wider (64-bit) or unsigned type.

```reveal
{
  "prompt": "Why does an unsigned 8-bit value go 255 → 0 when you add 1, instead of 256?",
  "answer": "8 bits can only represent 0–255. 255 is 1111 1111; adding 1 would need a 9th bit, which doesn't exist, so it wraps back to 0000 0000 = 0. The carry is simply dropped."
}
```

## In the wild

- **IPv4 addresses** are 32 bits (four bytes like `192.168.0.1`) — which is *why* the internet ran
  out of them (~4.3B) and IPv6 went to 128 bits.
- **Colors** on the web are 3 bytes — `#FF8800` is just red=255, green=136, blue=0.
- **Storage units** are powers of two: 1 KiB = 1024 bytes, 1 MiB = 1024 KiB. (Disk vendors sell
  "1 TB" as 10¹² bytes, which is why your "1 TB" drive shows as ~931 GiB.)
- **UTF-8** powers ~98% of the web; an emoji like 😀 is 4 bytes, which matters when a "character"
  limit may actually count bytes or code points, not what a user perceives as characters.

```compare
{
  "options": [
    { "label": "ASCII", "points": ["7 bits, 128 characters", "English letters/digits/symbols only", "1 byte per char", "A subset of UTF-8"] },
    { "label": "UTF-8", "points": ["1–4 bytes per character", "Covers all of Unicode (1M+ chars)", "ASCII-compatible for the first 128", "The web's default encoding"] }
  ]
}
```

## Common misconception — "a character is one byte"

This assumption silently breaks on real-world text.

```reveal
{
  "prompt": "A form limits a field to 10 'characters'. A user pastes 10 emojis and the database rejects it as too long. Why?",
  "answer": "Each emoji can be up to 4 bytes in UTF-8, so 10 emojis ≈ 40 bytes. If the column is VARCHAR(10) measured in bytes (or the limit counts bytes), the input overflows. 'Character count' and 'byte count' are different things — only true for plain ASCII."
}
```

A character is one byte **only in ASCII**. In UTF-8 it's 1–4 bytes; in UTF-16 it's 2 or 4. Length
limits, buffer sizes, and database columns must be clear about which they mean.

## Self-test

```quiz
{
  "question": "How many distinct values can a single byte (8 bits) represent?",
  "options": ["8", "128", "256", "1024"],
  "answer": 2,
  "explanation": "8 bits → 2^8 = 256 distinct patterns (0–255 if unsigned)."
}
```

```quiz
{
  "question": "An app's view counter is a signed 32-bit int and suddenly shows a large negative number. The most likely cause is:",
  "options": [
    "A database disk failure",
    "Integer overflow — it exceeded ~2.1 billion and wrapped around",
    "A Unicode encoding bug",
    "The network dropped packets"
  ],
  "answer": 1,
  "explanation": "Signed 32-bit maxes out at 2,147,483,647; adding past it wraps to negative. Use 64-bit/unsigned."
}
```

```quiz
{
  "question": "Which statement about UTF-8 is correct?",
  "options": [
    "Every character is exactly 2 bytes",
    "It can't represent emoji",
    "It uses 1–4 bytes per character and is ASCII-compatible",
    "It is the same as UTF-16"
  ],
  "answer": 2,
  "explanation": "UTF-8 is variable-width (1–4 bytes) and its first 128 code points match ASCII byte-for-byte."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "Binary & data representation — key terms", "cards": [ { "front": "Bit", "back": "The smallest unit of storage: a single on/off value (1 or 0), like a light switch. Everything else is a convention layered on top of bits." }, { "front": "Byte", "back": "A group of 8 bits, giving 256 possible patterns (0-255 unsigned). The basic unit for measuring data sizes." }, { "front": "Why does meaning need an agreement?", "back": "Bits don't know what they mean; the same byte can be a number, a letter, or part of a pixel. Meaning is a convention between whoever wrote and read the data." }, { "front": "ASCII", "back": "An encoding using 7 bits to assign 0-127 to English characters (A=65, a=97, 0=48). One byte per character; a subset of UTF-8." }, { "front": "Unicode vs UTF-8", "back": "Unicode assigns a number (code point) to every character (1M+). UTF-8 encodes those code points into 1-4 bytes and is ASCII-compatible for the first 128." }, { "front": "Integer overflow", "back": "When a value exceeds its type's maximum, the bits roll over to the most-negative (or 0). A signed 32-bit int wraps past 2,147,483,647 to negative." } ] }
```

## Key takeaways

- Everything is **bits**; meaning is a **convention** agreed between writer and reader — most bugs
  here are a convention mismatch.
- **8 bits = 1 byte = 256 values.** Each added bit doubles the range; widths (8/16/32/64) cap the
  largest number you can store.
- **Integer overflow** is values silently wrapping past a type's max — size your numeric types for
  the real-world maximum.
- **Text ≠ bytes.** ASCII is 1 byte/char; UTF-8 is 1–4. Be explicit about character-vs-byte counts.

## Up next

We can store numbers and text — but the CPU has to fetch them from *somewhere*, and where they live
decides how fast. Next: the **Memory Hierarchy**, from registers to disk.
