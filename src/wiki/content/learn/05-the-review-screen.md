# The review screen

After the AI reads your input, you land on Review mode — not the canvas. This is deliberate: review gives you a chance to fix the AI's interpretation before committing to a graph.

## What you see

- **Intent header** — a one-paragraph summary of what the AI thinks you're building. Editable. This is the anchor the simulation reasons against.
- **Components list** — each detected component with type, label, and a per-item confidence badge (low / med / high).
- **Connections paragraph** — how the AI thinks components talk. Plain English, editable.
- **"What did we see?" panel** — click to expand per-dimension confidence. Low-confidence dimensions are where you should look hardest.

## Three moves from here

1. **Looks right → Generate.** Commits to canvas.
2. **Edit the intent or connections** → **Re-derive from intent**. Useful when the AI got close but missed a hop or labeled something wrong. Re-running with corrected intent is cheaper than hand-fixing the canvas.
3. **Back out** → return to the landing input, try a different phrasing or image.

## When to accept low confidence

Low confidence on "number of instances" or "replica count" is fine — those get tuned in the config panel. Low confidence on a component's *type* or *existence* is worth fixing at this screen; fixing types downstream on the canvas is more work.

Next: [Your canvas](#docs/learn/the-canvas).
