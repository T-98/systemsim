# Your first design in 60 seconds

The fastest way to see SystemSim work is to run a template. Zero decisions required.

## Steps

1. **Back on the landing page**, scroll to "Or start from a template" and click **Basic CRUD App**. The canvas loads with a tiny stack: a client, a server, a database.
2. **Click the Run button** in the toolbar (top-right). The sim runs for 60 seconds of simulated time. Numbers appear on each component — RPS, p99, CPU%.
3. **Open the Debrief tab** at the bottom (it auto-surfaces when the run ends). You'll see per-component peak metrics, a numeric score, and 2–3 AI-generated questions about your design.

## What to notice

The Server node's CPU% hits some percentage. The DB shows connection utilization. The wires between them animate briefly with each tick. None of it is mocked — a discrete-event engine is actually processing requests per tick against your graph.

Once you've seen it run, everything else in the Learn track is about **shaping** that simulation: what components exist, how they're configured, what traffic you throw at them, how you read the results.

Next: [Describe your system in plain English](#docs/learn/describe-in-plain-english).
