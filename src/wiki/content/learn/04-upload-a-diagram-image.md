# Upload a diagram image

If you already have a sketch — Miro, Figma, Excalidraw, even a whiteboard photo — the AI can read the shapes and connections and build the canvas from it. This is the fastest path when you already know what you want.

## Steps

1. On the landing page, **paste** an image directly (⌘V works anywhere), **drag-and-drop** onto the input area, or click the attach icon to pick a file.
2. Optionally add text alongside the image ("this is a V1 design — production system will add sharding"). The AI merges both signals.
3. Click **Describe System**. Same review flow as the text path.

## What the AI reads well

- **Boxes labeled with component types** ("server", "Redis", "postgres", "LB"). Labels matter more than shapes.
- **Arrows between boxes.** Direction matters — arrow tails are sources, heads are targets. If your tool uses undirected connections, the AI guesses; results are noisier.
- **Grouping or columns** (tier / layer diagrams). Components in the same column usually become siblings.

## Where it gets confused

- **Handwritten arrows that overlap at junctions.** The AI may miss a branch.
- **Icons without labels.** A cloud icon could be CDN, S3, or "the internet" — add a word.
- **Multi-image boards.** Upload one coherent screen at a time (for now).

Supported formats: PNG, JPEG, WebP. Max size auto-resized client-side to ~5MB.

Next: [The review screen](#docs/learn/the-review-screen).
