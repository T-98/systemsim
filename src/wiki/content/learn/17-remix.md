# Remix — destructive regenerate

Sometimes the right move isn't to hand-edit the canvas. It's to throw it out and re-generate from a reworded intent. That's Remix.

## When to use Remix

- **The shape is wrong.** You have 8 microservices but you're modeling a 10-DAU prototype; you want to collapse to a monolith.
- **You ran once and learned something.** Add the learning to the intent ("under 5M DAU is fine, optimize for dev velocity") and regenerate.
- **You inherited a template that's close but not right.** Start from it, remix with your twist.

## How it works

1. Toolbar → **Remix** button. A confirm modal shows up: "This discards your current canvas. You can undo within 10 seconds." Click Continue.
2. The Remix input appears with your current intent pre-filled. Edit it.
3. Click Regenerate. A fresh graph replaces the current canvas.
4. A toast appears at the bottom: **"Canvas remixed — Undo"** (available for 10 seconds). Click Undo to revert.

## What Remix keeps

- **Your intent text** (pre-filled, editable).
- **Your traffic profile** — because profiles are orthogonal to the graph.

## What Remix replaces

- **All components.**
- **All wires.**
- **All configs.**
- **All API contracts and schema assignments.**

## When NOT to Remix

When the shape is mostly right but one component is wrong. Just click that component, edit its config, keep going. Remix is a sledgehammer; don't use it for surgery.

Next: [Resilience patterns](#docs/learn/resilience-patterns).
