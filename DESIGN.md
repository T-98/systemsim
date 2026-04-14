# SystemSim Design System

Apple-inspired. Calm surfaces, one accent, Inter throughout, tokens in `src/index.css`
as the source of truth. This document documents the system the code already enforces.
When the code and this doc disagree, `src/index.css` wins and this doc needs a fix.

## Voice

- **Direct.** No marketing-speak. "Describe your system" beats "Unlock the power of your architecture."
- **Non-technical-founder-friendly.** The end user is often a founder, not a platform engineer. Use plain English. First-person plural in intent output ("We let users…"), not third-person product-marketing ("Users can engage with…").
- **No emoji, no exclamation points, no "let's build something amazing!" energy.**
- **Every word earns its pixel.** If cutting a sentence makes the screen calmer, cut it.
- **Errors own both the problem and the fix.** "AI took too long to respond. Try again, or paste a smaller/simpler image." Not "Error 502."

## Color tokens

All colors live as CSS custom properties. **Never hardcode hex or rgb in components** — use `var(--token)`. Dark mode overrides the same token names, so components get dark mode for free.

### Backgrounds
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg-primary` | `#ffffff` | `#000000` | Page background |
| `--bg-secondary` | `#f5f5f7` | `#1d1d1f` | Sidebar, review-mode canvas |
| `--bg-tertiary` | `#ffffff` | `#000000` | Elevated card over secondary |
| `--bg-card` | `#f5f5f7` | `#1c1c1e` | Tinted card |
| `--bg-card-elevated` | `#ffffff` | `#272729` | Card that needs one step above the neighbors |
| `--bg-input` | `#fafafc` | `#1c1c1e` | Textarea/input field |
| `--bg-nav` | `rgba(255,255,255,0.72)` | `rgba(0,0,0,0.88)` | Sticky top bars, blurred |
| `--bg-hover` | `#e8e8ed` | `#2a2a2d` | Hover overlay |

### Borders
| Token | Light | Dark | Use |
|---|---|---|---|
| `--border-color` | `rgba(0,0,0,0.08)` | `#333336` | Default 1px border |
| `--border-strong` | `rgba(0,0,0,0.12)` | `#48484a` | Emphasized border |

### Text
| Token | Light | Dark | Use |
|---|---|---|---|
| `--text-primary` | `#1d1d1f` | `#f5f5f7` | Headings, body |
| `--text-secondary` | `rgba(0,0,0,0.8)` | `rgba(255,255,255,0.8)` | Main body, slightly softer |
| `--text-tertiary` | `rgba(0,0,0,0.48)` | `rgba(255,255,255,0.48)` | Helper, meta, labels |
| `--text-on-accent` | `#ffffff` | `#ffffff` | Text on Apple Blue buttons |

Contrast: `--text-tertiary` on `--bg-primary` is 4.5:1 at 14px (WCAG AA pass). Don't go softer than tertiary on text the user has to read.

### Accent (one, only one)

Apple Blue. **There is no secondary accent. Do not introduce a second color for "variety."** If something needs emphasis without using the accent, emphasize via weight, size, or spacing — not color.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--accent` | `#0071e3` | `#2997ff` | Primary CTA background |
| `--accent-hover` | `#0077ed` | `#40a9ff` | Hover state on primary CTA |
| `--accent-link` | `#0066cc` | `#2997ff` | Text link |
| `--accent-ring` | `rgba(0,113,227,0.25)` | `rgba(41,151,255,0.25)` | Focus ring / drop-zone tint |

### Status colors (use sparingly)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--destructive` | `#ff3b30` | `#ff453a` | Error banner border/text |
| `--warning` | `#ff9f0a` | `#ff9f0a` | Low-confidence banner, amber affordances |
| `--success` | `#34c759` | `#30d158` | High-confidence indicator, completed status |

**Banner convention:** amber or red at 8% background + 20% border + vivid text. See `ReviewMode.tsx` for the reference pattern. Do not reinvent banner styling per component.

## Typography

- **Font:** Inter (system fallback). No other font stacks.
- **Monospace:** SF Mono → Menlo → Consolas → monospace. Used only for code, spec text, or arrow-prose (`ReviewMode` connections editor).
- **Letter-spacing:** Always negative, scales with size. `-0.224px` at 14px. `-0.12px` at 12px. `-0.32px` at 15-16px. `-0.5px` at 24px+. This is the single most recognizable Apple-typography tell — never skip it.
- **Weights:** Regular (400) body; Medium (500) section labels; Semibold (600) headings.

### Size scale

| Use | Size | Line height | Weight | Letter-spacing |
|---|---|---|---|---|
| Section heading | 24px | 1.25 | 600 | -0.5px |
| Subsection / brand | 15-16px | 1.4 | 600 | -0.32px |
| Body | 14px | 1.5 | 400 | -0.224px |
| Helper, button, meta | 13px | 1.4 | 400-500 | -0.224px |
| Tiny meta, chip sublabel | 12px | 1.4 | 400 | -0.12px |
| Micro (disclosure indicator, pill count) | 11px | 1.3 | 500-600 | -0.12px |

## Spacing

Rhythm is 4 / 8 / 12 / 16 / 24 / 32 / 48. Don't interpolate. Don't use 15px "for balance" — pick 12 or 16.

Review mode content: **720px max width**, centered, 48px top padding. Don't widen. Two-textarea screens stay readable.

## Border radius

| Value | Use |
|---|---|
| `6px` | Small inline buttons, chips, tags |
| `8px` | Default — buttons, textareas, banners, inputs |
| `11px` | Slightly larger containers (UnifiedInput zone) |
| `980px` | Pills (we don't use these yet) |

Never use `border-radius: 50%` for ornamental circles around icons. See AI-slop rules below.

## Shadows

**Rare.** Most surfaces have no shadow. Use one of:

| Token | Value | Use |
|---|---|---|
| `--shadow-card` | `rgba(0,0,0,0.08) 0px 2px 12px 0px` | Elevated card on top of colored bg |
| `--shadow-elevated` | `rgba(0,0,0,0.12) 0px 4px 24px 0px` | Modal, popover |

Never invent a new shadow. Decorative shadows for "depth" are AI slop.

## Interaction states

Every interactive element needs a visible state for: default, hover, focus, disabled, loading.

- **Focus:** `1px solid var(--accent)` + `box-shadow: 0 0 0 2px var(--accent-ring)`. Applied to textareas, primary buttons, file-input triggers.
- **Hover on primary CTA:** swap background to `--accent-hover`.
- **Hover on secondary/link:** underline only, no color shift.
- **Disabled:** `opacity: 0.3`. Keep the label visible — the tooltip explains why.
- **Loading (button):** copy flips ("Generate" → "Generating…"), spinner appears inline. Use the spinner pattern in `TextToDiagram.tsx:172-180`.

## Component conventions

### Primary button

```tsx
style={{
  padding: '8px 16px',
  fontSize: 14,
  letterSpacing: '-0.224px',
  background: 'var(--accent)',
  color: 'var(--text-on-accent)',
  borderRadius: 8,
}}
```

Disabled = `opacity: 0.3`. Never use a second color for secondary buttons — fall back to `background: 'var(--bg-card)'` + `border: 1px solid var(--border-color)`.

### Textarea

```tsx
style={{
  padding: '14px 16px',
  borderRadius: 8,
  border: '1px solid var(--border-color)',
  background: 'var(--bg-tertiary)',
  color: 'var(--text-primary)',
  outline: 'none',
}}
onFocus={(e) => {
  e.currentTarget.style.borderColor = 'var(--accent)';
  e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent-ring)';
}}
onBlur={(e) => {
  e.currentTarget.style.borderColor = 'var(--border-color)';
  e.currentTarget.style.boxShadow = 'none';
}}
```

Resize: `vertical` usually. `none` only for fixed-height composers (UnifiedInput).

### Inline-style pattern

Components use `style={{}}` with CSS variables rather than utility classes for colors. This keeps the token system portable and dark-mode-automatic. Tailwind utility classes are fine for layout (`flex`, `gap-*`, `items-center`).

**Rule:** if the value references a design token, use inline style. If it's layout-only, use a utility class.

### Chip / tag

6px radius, `var(--bg-tertiary)` background, `var(--border-color)` border, 13px primary label + 11px tertiary sublabel on one line. See `ImagePreviewChip.tsx` and component chips in `ReviewMode.tsx`.

### Banner

Amber (warning) or red (error) at:
- Background: `rgba(X,Y,Z,0.08)`
- Border: `rgba(X,Y,Z,0.2)`, 1px
- Padding: `12px 14px`
- Radius: 8px
- Icon: 16px from Lucide, matching color, `flex-shrink: 0`
- Body: 13px, `var(--text-secondary)`, 1.5 line-height

## AI-slop blacklist

If the design reviewer catches any of these, they go straight back:

1. **Purple, violet, indigo.** We have one accent: Apple Blue. Gradients from blue to purple are generic SaaS.
2. **3-column feature grid** with icons-in-colored-circles. The most recognizable AI-generated layout.
3. **Ornamental icons in colored circles.** Icons are functional, not decorative.
4. **Centered everything.** Left-align headings in content areas. Center only for brand / hero-like moments.
5. **Bubbly border-radius on every element.** Stick to 6/8/11.
6. **Decorative blobs, floating SVG circles, wavy dividers.** If a section feels empty, the copy or hierarchy is wrong.
7. **Emoji as design elements.** No rockets in headings, no emoji bullet points.
8. **Colored left-border accents on cards.** `border-left: 3px solid teal` screams starter template.
9. **Generic hero copy.** "Welcome to SystemSim", "Your all-in-one distributed systems solution", "Unlock the power of…" — rewrite.
10. **Cookie-cutter section rhythm.** Hero → 3 features → testimonials → pricing is not a design, it's a template.

## Accessibility minimums

- All textareas have `aria-label` matching the visible label.
- Every button has a clear label, either visible or via `aria-label`.
- Loading announcements use `role="status" aria-live="polite"`.
- Error banners use `role="alert"`.
- Focus rings (`--accent-ring`) are always visible on keyboard focus.
- Color contrast verified at 14px for tertiary text.
- Keyboard shortcuts: `Cmd/Ctrl+Enter` submits composer textareas. `Escape` cancels inline edits.

## Responsive

Desktop-first. Min width 900px for the full canvas experience — `DesktopOnlyNotice` shows a soft warning below that. Mobile responsive is not in scope. Tablet (768-900px) works with scroll.

## Where this lives

- **Tokens:** `src/index.css`
- **Reference components:** `ImagePreviewChip.tsx`, `ConfirmModal.tsx`, `UnifiedInput.tsx`, `ReviewMode.tsx`, `IntentHeader.tsx`, `ConfidencePanel.tsx`
- **This doc:** `DESIGN.md` — updates when tokens change or new patterns land

## When in doubt

- **As little design as possible** (Rams). Cut before you add.
- **The right thing easy, the wrong thing hard.** No ornate buttons inviting misuse.
- **Would I notice the design?** The highest compliment is "I didn't notice it, it just worked."
