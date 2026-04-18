# Describe your system in plain English

Most users don't start with a template. They start with a sentence. The unified input on the landing page accepts text, images, or both — this page is about the text path.

## Steps

1. In the landing-page input, type what you want. **Be specific about scale and purpose.** Example: *"A Twitter-like feed for 2M DAU. Users post short text updates and see a timeline of people they follow. Read-heavy: roughly 50:1 reads to writes. Needs to stay responsive during celebrity-post spikes."*
2. Click **Describe System**. An AI reads your text and proposes components, connections, and a brief intent summary.
3. Land on the **Review screen** (the next page explains that in depth). You can accept, edit components, or go back.

## What makes a good description

- **Name the use case.** "Chat", "feed", "checkout", "analytics dashboard" — not "a system that handles requests."
- **Name the scale.** DAU, peak QPS, read/write ratio. The AI picks component counts and DB shapes based on these numbers.
- **Name the pain.** "Must handle Black Friday spike", "can't lose a write", "99.95% availability". Pain drives architecture.

## What doesn't help

- Technical specs lifted from docs ("uses gRPC with protobuf"). The simulator models at a higher level; it doesn't care about wire protocol.
- A bullet list of components ("server, cache, DB, queue"). That's the output — starting from there skips the reasoning.

Next: [Upload a diagram image](#docs/learn/upload-a-diagram-image).
