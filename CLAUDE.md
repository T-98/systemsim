# SystemSim — Claude Code Configuration

## Project Overview
SystemSim is a distributed systems design simulator. React + TypeScript + Vite + Tailwind CSS.

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__Claude_in_Chrome__*` tools.

### Available gstack skills
- `/office-hours` — Office hours session
- `/plan-ceo-review` — Plan CEO review
- `/plan-eng-review` — Plan engineering review
- `/plan-design-review` — Plan design review
- `/design-consultation` — Design consultation
- `/design-shotgun` — Rapid design iteration
- `/design-html` — Design in HTML
- `/review` — Code review
- `/ship` — Ship changes
- `/land-and-deploy` — Land and deploy
- `/canary` — Canary deployment
- `/benchmark` — Performance benchmarking
- `/browse` — Web browsing (use this instead of Chrome MCP tools)
- `/connect-chrome` — Connect Chrome browser
- `/qa` — Quality assurance
- `/qa-only` — QA only (no code changes)
- `/design-review` — Design review
- `/setup-browser-cookies` — Setup browser cookies
- `/setup-deploy` — Setup deployment
- `/retro` — Retrospective
- `/investigate` — Investigate issues
- `/document-release` — Document a release
- `/codex` — Codex operations
- `/cso` — CSO operations
- `/autoplan` — Automatic planning
- `/plan-devex-review` — Plan DevEx review
- `/devex-review` — DevEx review
- `/careful` — Careful mode (extra validation)
- `/freeze` — Freeze changes
- `/guard` — Guard mode
- `/unfreeze` — Unfreeze changes
- `/gstack-upgrade` — Upgrade gstack
- `/learn` — Learn from context

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health

## For Claude Cowork in "Act" mode
- gtsack skills above might prompt user input each time to make certain decisons. Limit prompting the user to continue or not only for the folowing skills: office-hours, design-shotgun
- for every other skill, choose the recommended choice.
- Always use codex for engineering plan reviews as an adversarial reviewer, always use codex for outside opinion. Use claude subagents only if codex is unavaialble or erroring out beyond repair.