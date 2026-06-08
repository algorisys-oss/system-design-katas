---
title: "MQTT"
slug: mqtt
level: intermediate
module: messaging-and-streaming
order: 26
reading_time_min: 12
concepts: [mqtt, iot, pub-sub, qos, lightweight-protocol, last-will]
use_cases: []
prerequisites: [publish-subscribe, tcp]
status: published
---

# MQTT

## Hook — a motivating scenario

You're connecting 100,000 battery-powered sensors over flaky cellular links. HTTP's per-request
overhead (headers, connection setup) would drain batteries and clog the network; a heavyweight broker
protocol won't run on a $2 microcontroller. You need something **tiny, efficient, and resilient to
drops**. **MQTT** is the protocol built exactly for this — the de-facto standard for IoT messaging.

## Mental model — lightweight pub/sub for constrained devices

**MQTT (Message Queuing Telemetry Transport)** is a **lightweight publish/subscribe** protocol over
TCP, designed for **low bandwidth, low power, and unreliable networks**. Devices connect to a
**broker** and publish/subscribe to **topics** (hierarchical, like `home/livingroom/temp`) — the same
pub/sub fan-out model you know, but with a minimal wire format and features tuned for tiny, flaky
clients.

## Build it up — what makes it fit IoT

- **Tiny overhead** — a minimal binary header (as little as ~2 bytes) vs HTTP's verbose text headers,
  so it sips bandwidth and battery.
- **Persistent connection** — a device opens one long-lived TCP connection and keeps it alive
  (heartbeat "keepalive" pings), avoiding repeated handshakes (recall TCP/TLS setup cost).
- **Quality of Service (QoS) levels** — choose the delivery guarantee per message:
  - **QoS 0** — at-most-once ("fire and forget"); may be lost.
  - **QoS 1** — at-least-once (acked, may duplicate → consumers idempotent).
  - **QoS 2** — exactly-once (more handshaking, higher cost).
- **Last Will & Testament (LWT)** — the device pre-registers a message the broker publishes **if the
  device disconnects unexpectedly**, so the system learns a sensor went offline.
- **Retained messages** — the broker keeps the last message per topic so a new subscriber immediately
  gets the current value.

```reveal
{
  "prompt": "Why is MQTT's choice of QoS level per message important for battery-powered sensors?",
  "answer": "Higher QoS means more network round trips and acknowledgements, which cost bandwidth, power, and latency — precious on a battery sensor over cellular. So you match QoS to the data's importance: a frequent, redundant temperature reading can use QoS 0 (fire-and-forget — if one is lost, the next arrives shortly, and you saved the ack overhead/battery). A critical alarm or command should use QoS 1 or 2 to guarantee delivery despite the extra cost. Letting each message pick its QoS lets you spend the device's limited power/bandwidth budget only where reliability truly matters, rather than paying exactly-once overhead for throwaway telemetry. It's a per-message reliability-vs-cost dial — exactly what constrained devices need."
}
```

MQTT's QoS is a per-message reliability dial — slide from cheapest/least reliable to costliest/guaranteed:

```tradeoff
{ "title": "Which MQTT QoS level for this message?", "axis": { "left": "Cheapest / may lose", "right": "Costliest / guaranteed once" }, "steps": [ { "label": "QoS 0", "detail": "At-most-once, fire-and-forget. No ack, no round trips — saves bandwidth, power, latency. Message may be lost. Good for frequent, redundant telemetry like temperature readings." }, { "label": "QoS 1", "detail": "At-least-once. Acked so it won't be lost, but may duplicate, so consumers must be idempotent. Use for important data and commands worth the extra round trip." }, { "label": "QoS 2", "detail": "Exactly-once. The strongest guarantee, via more handshaking and higher cost in bandwidth, power, and latency. Reserve for critical alarms or commands that must arrive once." } ] }
```

## Build it up — MQTT vs HTTP/AMQP for IoT

```compare
{
  "options": [
    { "label": "MQTT", "points": ["Tiny header; persistent connection", "Pub/sub topics; per-message QoS; LWT; retained msgs", "Built for low power / bandwidth / flaky links", "De-facto IoT standard"] },
    { "label": "HTTP per request", "points": ["Verbose headers; connection per request", "Request/response (polling for updates)", "Heavy for constant small telemetry", "Fine for occasional calls, bad for sensor swarms"] }
  ]
}
```

```reveal
{
  "prompt": "What does MQTT's 'Last Will and Testament' solve that plain pub/sub doesn't?",
  "answer": "Detecting ungraceful disconnects. With ordinary pub/sub, if a device's battery dies or its network drops, it simply stops publishing — the system has no immediate, explicit signal that it went offline; you'd have to infer it from silence/timeouts. LWT fixes this: when a device connects, it registers a 'will' message (e.g. publish 'status=offline' to home/sensor7/status) that the broker stores and automatically publishes on the device's behalf if the connection drops unexpectedly (missed keepalives). So other systems get a prompt, explicit 'this device is offline' notification without polling each device. It's a built-in liveness/last-gasp mechanism tailored to unreliable IoT connections — turning silent failures into actionable events."
}
```

## In the wild

- **MQTT is the dominant IoT messaging protocol** — smart home, industrial sensors, connected
  vehicles, telemetry at massive device counts (brokers: Mosquitto, EMQX, HiveMQ; AWS IoT Core).
- It's **pub/sub** (recall that chapter) optimized for constrained clients; often **MQTT at the edge →
  bridged into Kafka** for backend stream processing.
- Runs over TCP (and TLS for security); **MQTT-SN** variant exists for non-TCP/sensor networks.
- The **QoS / keepalive / LWT / retained** features are what distinguish it from generic pub/sub.

## Common misconception — "MQTT is a general-purpose message broker like Kafka/RabbitMQ"

It's a specialized lightweight pub/sub protocol for constrained devices, not a backend event backbone.

```reveal
{
  "prompt": "Why wouldn't you use MQTT as your backend event-streaming/messaging backbone instead of Kafka or RabbitMQ?",
  "answer": "MQTT is optimized for the IoT edge: tiny clients, low bandwidth, flaky links, and simple pub/sub with per-message QoS. It's not designed to be a durable, replayable event log (no Kafka-style retained partitions/offsets/replay) or a rich task broker (no RabbitMQ-style complex routing, work queues, or sophisticated delivery workflows). Using it as a backend backbone means you lack replay/history, large-scale stream processing integration, and advanced routing/durability guarantees — you'd be fighting its lightweight, device-facing design. The common, correct pattern is MQTT for device↔broker communication at the edge, then bridge those messages into Kafka (or a queue) for durable, scalable backend processing. MQTT excels at the constrained-device tier; Kafka/RabbitMQ excel at the backend tier — different layers, not substitutes."
}
```

MQTT is a **lightweight pub/sub protocol for constrained, unreliable IoT clients** — with per-message
QoS, keepalive, LWT, and retained messages — not a general backend broker. Bridge it into Kafka/queues
for backend processing.

## Self-test

```quiz
{
  "question": "MQTT is primarily designed for:",
  "options": [
    "High-throughput backend event streaming",
    "Lightweight pub/sub messaging for low-power, low-bandwidth, unreliable (IoT) devices",
    "Relational database replication",
    "Serving static web assets"
  ],
  "answer": 1,
  "explanation": "MQTT is a minimal-overhead pub/sub protocol built for constrained IoT clients on flaky networks."
}
```

```quiz
{
  "question": "MQTT QoS levels let you:",
  "options": [
    "Encrypt messages",
    "Choose the delivery guarantee per message (at-most / at-least / exactly once), trading reliability vs cost",
    "Compress topics",
    "Replay historical events"
  ],
  "answer": 1,
  "explanation": "QoS 0/1/2 pick at-most-once, at-least-once, or exactly-once per message — balancing reliability against bandwidth/power."
}
```

## Recap — key terms

Flip each card to check yourself, then move through the deck:

```flashcards
{ "title": "MQTT — key terms", "cards": [ { "front": "MQTT", "back": "Message Queuing Telemetry Transport: a lightweight publish/subscribe protocol over TCP, designed for low-bandwidth, low-power, unreliable networks. The de-facto IoT messaging standard." }, { "front": "Broker and topics", "back": "Devices connect to a broker and publish/subscribe to hierarchical topics (e.g. home/livingroom/temp), giving pub/sub fan-out with a minimal binary wire format." }, { "front": "QoS 0 / 1 / 2", "back": "Per-message delivery guarantee: QoS 0 at-most-once (fire-and-forget, may lose), QoS 1 at-least-once (acked, may duplicate), QoS 2 exactly-once (more handshaking, higher cost)." }, { "front": "Last Will & Testament (LWT)", "back": "A message a device pre-registers that the broker publishes automatically if the device disconnects unexpectedly, signaling the sensor went offline without polling." }, { "front": "Retained messages", "back": "The broker keeps the last message per topic so a new subscriber immediately receives the current value instead of waiting for the next publish." }, { "front": "Keepalive connection", "back": "A device holds one long-lived TCP connection alive with heartbeat pings, avoiding repeated TCP/TLS handshakes and saving battery and bandwidth." } ] }
```

## Key takeaways

- **MQTT** is a **lightweight pub/sub protocol** over TCP for **low-power, low-bandwidth, unreliable
  (IoT)** devices.
- Key features: **tiny overhead**, **persistent keepalive connection**, **per-message QoS (0/1/2)**,
  **Last Will & Testament** (disconnect detection), and **retained messages**.
- It's **specialized for the device edge**, not a general backend broker — commonly **bridged into
  Kafka** for backend processing.
- Choose QoS to match each message's importance against the device's power/bandwidth budget.

## Up next

From device messaging to the browser: pushing live data to users. Next: **Real-Time Communication**.
