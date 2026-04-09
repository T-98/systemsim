# SystemSim — Marketing Strategy

## Product Positioning (non-technical)

SystemSim is a practice arena for the people who design the internet's plumbing. And it has a memory.

When you send a message on Discord and it instantly reaches 500,000 people in a server, someone had to design the system that makes that happen. If they design it wrong, Discord goes down and millions of people can't talk to their friends.

Right now, those designers have no way to test their ideas before building the real thing. They draw their plan on a whiteboard, say "I think this works," and then build it. If they're wrong, they find out at 3am when everything breaks.

**SystemSim lets them test the bridge before they build it.**

You drag pieces onto a screen, wire them together, press "Run," and watch fake traffic flood through your design. Little dots flow through your system. Things start turning yellow, then red, then they crash. You see exactly where and why.

### The Similarity Engine (the real differentiator)

Say you're building a notification system. You start designing, and SystemSim says: "Hey, Discord already solved something really similar to what you're building. Uber's ride-matching system also has a version of this problem. Want to see how those designs handled the same traffic pattern?"

It's like having a library of every bridge ever built. Before you design yours, the tool says "three bridges with similar weight requirements already exist. Here's how they performed. Try yours against the same test."

You're not copying their answer. You're borrowing their exam. You run YOUR design against the same conditions that already stressed a proven system, and you see how yours compares. Maybe you discover your approach handles the spike better. Maybe you discover a failure mode they already solved that you hadn't thought of.

**Every time someone uses SystemSim, the library gets smarter.** More scenarios, more patterns, more "someone already solved a version of this" moments. That's the flywheel ... the tool gets more valuable the more people use it.

### The Socratic Layer

When your design breaks, the tool doesn't tell you the answer. It asks you smart questions like a good teacher: "You noticed one part of your database handled 78% of the work while three other parts sat idle. Why do you think that happened?"

You learn because you felt the consequence, not because someone lectured you.

### The Credibility Artifact

Then you get a shareable report card you take into a meeting: "I tested my design against the same conditions Discord handles. Here's what I found."

**The whole pitch in one sentence:** SystemSim knows how the internet's hardest problems have already been solved, and it lets you test your design against that history before you build anything.

---

## The Core Emotional Insight

Engineers don't say "I don't want to look stupid" out loud. But they feel it constantly. This is the engine behind everything we market.

---

## Angle 1: "Know Before You Go" (the quiet confidence play)

Engineers feel the fear every time they:

- Walk into a design review and someone asks "what happens at 10x load?"
- Present to a VP and get asked "how do we know this scales?"
- Interview at a company and get a system design question they've never seen
- Ship something to production and pray

**The marketing doesn't say "you have gaps." It says "you already know this, now prove it."**

### Tagline candidates

- **"Test your architecture before your architecture tests you."**
- **"The design review that happens before the design review."**
- **"Know what breaks before it breaks."**

### Emotional promise

You walk into that room with receipts. Not "I think this works" but "I ran 45,000 requests per second through this design and here's what happened." The debrief report IS the marketing ... it's the artifact that says "this person did the work."

### Who this speaks to

Mid-level engineers moving into senior roles. The moment in your career where you go from "I build what I'm told" to "I decide what we build." That transition is terrifying because suddenly your judgment is the product, and you're not sure your judgment is ready.

---

## Angle 2: "The Knowledge Gap Is a Confidence Gap" (the loud play)

More confrontational. Names the thing nobody talks about.

### The dirty secret of software engineering

Most engineers design distributed systems based on blog posts they half-remember, a talk they saw at a conference two years ago, and whatever their last company happened to use. Nobody admits this. Everyone nods along in design reviews like they've done this before.

The knowledge gap isn't "I don't know what a load balancer is." It's "I've never actually seen what happens when my specific sharding strategy meets a traffic spike." You can read about hot shards in a blog post. You can't FEEL a hot shard until you watch 78% of your writes pile into one partition while three others idle.

### Tagline candidates

- **"You've read about cascade failures. Have you caused one?"**
- **"The gap between knowing the theory and trusting your design."**
- **"Every senior engineer has a production incident that taught them something a textbook couldn't. SystemSim gives you the incident without the 3am page."**

### Content marketing that writes itself

- "5 Architecture Mistakes You Can Only Learn By Making" ... each one is a SystemSim scenario
- "I Ran My Startup's Architecture Through a Stress Test. Here's What Broke." ... founder stories using their own debrief reports
- "The System Design Knowledge Nobody Talks About" ... the gap between book knowledge and operational intuition

---

## Funnel Strategy: Which Angle Where

### Top of funnel (attention): Angle 2

The knowledge gap angle gets attention. It's the tweet, the blog post, the conference talk. It makes engineers go "...yeah, that's me." It's shareable because it names a universal insecurity without being mean about it.

"Every senior engineer has a production incident that taught them something" ... that's a statement that makes people nod and forward.

### Middle of funnel (conversion): Angle 1

Once they're on the site, the message shifts from "you have a gap" to "here's how you close it." The debrief report is the proof. The scenario library is the credibility.

"Test your architecture before your architecture tests you" is what they tell their team lead when they share the link.

### Bottom of funnel (retention): The Similarity Engine

The similarity index (borrowing from proven designs) is the retention hook. It's what makes engineers come back.

"Oh, my notification system has the same shape as Discord's fanout? Let me see how that performed."

Every time they come back, the library has more patterns, more comparisons, more "someone already solved a version of this."

---

## Landing Page Hero

> **Every architecture decision is a bet. Stop guessing. Start simulating.**

Sub-headline: "See how your design compares to systems already running in production."

---

## Target Segments (in priority order)

1. **Mid-to-senior engineers at startups** ... making architecture decisions with real consequences, no time for mistakes, need confidence fast
2. **Engineers preparing for system design interviews** ... need to go beyond theory, want to feel what it's like to make real tradeoffs
3. **Tech leads presenting to leadership** ... need the credibility artifact, need to show they've done the diligence
4. **Students in CS programs** ... learning distributed systems, want the professional experience without the professional consequences

---

## Distribution Channels

### Organic / viral
- **The debrief report itself** ... engineers share reports with teams, recipients discover SystemSim
- **"I broke my own architecture" posts** ... users sharing their failures (and learnings) on Twitter/LinkedIn
- **Scenario-specific content** ... "Can your design handle Discord's traffic?" as shareable challenges

### Community
- Hacker News launches (the "Logisim for backend architecture" framing resonates with HN)
- Reddit r/ExperiencedDevs, r/softwarearchitecture
- Discord/Slack engineering communities
- Conference lightning talks: "I stress-tested my architecture in 20 minutes"

### Content
- Blog series around each scenario (Discord fanout, Uber matching, etc.)
- "Architecture autopsy" series ... famous outages recreated as SystemSim scenarios
- YouTube: screen recordings of designs breaking in real-time (the particle view is inherently watchable)

---

## Key Metrics to Track

- **Time to first simulation run** ... measures zero-friction promise (target: <2 min)
- **Debrief share rate** ... measures credibility artifact value (target: >20% of completed runs)
- **Return visit rate after similarity match** ... measures flywheel engagement
- **Scenario completion rate** ... measures whether the experience delivers (target: >80%)
- **"I didn't think about that" signal** ... qualitative, from user interviews and feedback

---

## Customer Interview Log

### Interview #1: Ronith (2026-04-08)

**Profile:** Junior computer/electronics engineer. Works at a company using Microsoft Teams (Boeing compliance). Has theoretical knowledge of system design (DynamoDB partition keys, sort keys) but zero production failure experience. Has not yet been asked to do architecture work in his current role.

**Segment:** Secondary user (student/aspirational), not primary (professional with stakes).

#### What validated

| Thesis | Evidence | Strength |
|--------|----------|----------|
| "Don't look dumb" emotional core | Confirmed unprompted: biggest concern for developers is not wanting to "look dumb" when presenting designs | Strong |
| Deterministic sim > LLM output | Resonated strongly as a trust factor. Engineers trust it BECAUSE it's code-based, not AI-generated hallucination | Strong (new insight) |
| Debrief as credibility artifact | Recognized advantage of showing simulation reports to seniors instead of raw ChatGPT conversations | Strong |
| Zero-friction Excalidraw model | Free, no-subscription model with cloud storage as paid tier "aligns with user expectations" | Moderate |
| Exploration/play value | "Opens up untested territories where people can actually just come and play, create system design on the spot and test them out" | Strong |
| Learning flywheel | Would make him "more likely to try more system design problems and learn it more" because "it's making your life easier" | Strong |

#### What raised flags

| Signal | Concern | Implication |
|--------|---------|-------------|
| Aspirational use only | "Would definitely help once he's asked to do architectural planning" ... he doesn't need it TODAY | Need to interview someone with current, high-stakes architecture decisions |
| Wants to prepare before using | Plans to "read up a lot" and "get pretty deep into system design" before piloting | Contradicts zero-friction thesis. If users feel they need to study first, the onboarding isn't meeting them where they are |
| No objections raised | Zero pushback, no competitors mentioned, no skepticism | Politeness risk. Enthusiastic agreement without friction can mean the person was being nice, not that the product is bulletproof |
| No budget/procurement signal | Individual use case only, no organizational context | Learning tool adoption path, not enterprise sale |

#### New positioning insight: "Not AI hallucination"

Ronith's reaction to deterministic simulation is a messaging opportunity we hadn't identified. Engineers are increasingly skeptical of AI-generated answers. SystemSim's simulation is CODE running on your architecture, not an LLM guessing. This is a trust differentiator worth making explicit in marketing:

> **"Your architecture, stress-tested by code. Not guessed at by AI."**

This positions SystemSim against the rising tide of "just ask ChatGPT" while leveraging the Socratic AI layer as the complement (AI asks the questions, deterministic code provides the evidence).

#### Action items from this interview

1. **Next interview MUST be a mid-to-senior engineer currently making architecture decisions.** Ronith validates the aspirational/learning use case. We need to validate the professional/stakes use case.
2. **Investigate the "preparation anxiety" signal.** If junior engineers feel they need to study before using SystemSim, consider: (a) beginner-friendly scenario as an on-ramp, (b) progressive complexity within scenarios, (c) explicit messaging: "you don't need to know the answer, you need to feel the consequence"
3. **Add "Not hallucination" messaging to landing page.** The code-based trust factor is a differentiator worth naming.
4. **Track pilot user:** Ronith committed to pilot after self-study. Follow up with early access when build is ready.
