# YP Console — visual system for the Digital Dash

Two themes ship. `console` is the new default. `legacy` is the current look, preserved
verbatim and switchable at any time.

The brief was blunt: the dash "looks like Claude AI slop." That is a fair read, and it is
diagnosable. What follows names the specific failure and the specific rule that replaces it.

---

## What "slop" actually is, and the six rules that fix it

Pulled from reference sweep (Pinterest: pro NLE timelines, DAW/audio software, dense data
terminals). Every rule below is a thing the references do and the current dash does not.

### 1. Kill the floating card

**Now:** every region is a rounded rectangle with a visible border, floating on a flat
field. Twelve boxes, twelve borders, no hierarchy — the signature of generated UI.

**Rule:** structure comes from **hairlines and background value steps**, not from boxes.
Panels are full-bleed and divided by 1px rules at 8% cream. A border is reserved for
things you can *click*. Nothing gets a shadow.

### 2. Color is data, never decoration

**Now:** amber is on borders, badges, buttons, icons and headings simultaneously. When
everything is amber, amber means nothing.

**Rule:** a colored pixel carries information.

| Colour | Reserved meaning |
|---|---|
| Amber `#F58804` | **Now** — playhead, active row, current selection, live state |
| Gold `#FFDE00` | `singing` — vocal takes, in the music map and on tags |
| Warm grey | `beat` / instrumental |
| Sienna `#BC4803` | needs edit, warning, clearance required |
| Mint `#7FD4C1` | system OK — QA passed, render complete. **Dots and 1px rules only, never a fill.** The one cool tone in a warm system; it exists so "content" and "machine" never wear the same colour |

Everything else is greyscale. If it is not one of the five, it is not coloured.

### 3. Numbers are monospace, tabular, and large

**Now:** JetBrains Mono is loaded in `layout.tsx` and barely used; scores render in the
body face at body size.

**Rule:** every number — timecode, score, BPM, duration, count, percentage — is mono with
`font-variant-numeric: tabular-nums`. Columns of numbers align on the decimal. This single
change does more for the "professional tool" read than any other.

### 4. Micro-labels recede, values dominate

**Rule:** labels are Archivo 10-11px, uppercase, `letter-spacing: 0.14em`, at `--ink-dim`.
Values are 1.5-3x the label size at full contrast. The eye lands on the number.

### 5. Density is the point

**Now:** uniform 16px padding, 56px rows — a marketing page's rhythm applied to a tool.

**Rule:** list rows 28-32px. Tight gutters. Whitespace is spent where the eye needs rest —
around the video preview — and nowhere else. A 2h47m stream with 10 candidates should fill
the screen the way an arrangement view does.

### 6. Exactly one editorial gesture per screen

**Rule:** Anton (display face) appears **once** per screen, large, on that screen's
subject — the score on a clip, the stream name on the timeline. One loud element with
everything else quiet is composition. Three loud elements is noise, and uniform size is
the AI tell.

---

## Tokens

### `console` (new default)

```
--ground        #08070A   near-black, faintly cool so amber reads warm against it
--panel         #0E0D11
--raised        #16141A
--line          rgba(244,227,198,0.08)
--line-strong   rgba(244,227,198,0.16)

--ink           #F4E3C6   cream — primary text
--ink-dim       #8A8A8A   labels, secondary
--ink-faint     #4E4A52   disabled, ruler ticks

--amber         #F58804   brand, and "now"
--gold          #FFDE00   singing
--sienna        #BC4803   needs edit / warning
--mint          #7FD4C1   system ok
```

Ground is `#08070A` rather than `#0c0c0c`: a hair cooler and darker, which makes the same
amber read warmer and lets three panel values separate without any of them looking grey.

### `legacy`

The existing values, unchanged: `--color-void #000000`, `--color-coal #0c0c0c`,
`--color-charcoal #1a1a1a`, amber/gold/cream/sienna/rust/warmgray as-is. Selecting
`legacy` must reproduce today's dashboard exactly.

---

## Type

| Role | Face | Spec |
|---|---|---|
| Display (one per screen) | Anton | 48-72px, tight leading, `-0.02em` |
| Section heading | Archivo | 13px, uppercase, `0.12em`, `--ink-dim` |
| Micro-label | Archivo | 10-11px, uppercase, `0.14em`, `--ink-dim` |
| Body / copy fields | Inter | 13-14px |
| **All numerals** | JetBrains Mono | tabular, `-0.01em` |

---

## Implementation contract

The theme is a **token swap, not a rewrite.** Tailwind v4 `@theme` tokens compile to
`var(--color-*)` references, so redefining those properties under `[data-theme="console"]`
re-skins every component that resolves through a token — no component edits required.

That only holds for styles that actually go through tokens. Literal colours
(`bg-[#0c0c0c]`, `bg-white/5`, `text-zinc-400`, `ctx.fillStyle = '#f58804'`) ignore the
swap and must be converted to tokens first. Those are the real work; the audit inventories
them.

Rules 1, 3, 4, 5 and 6 are structural — spacing, type scale, hairlines-instead-of-borders.
Those are component-level and land after the token layer, per route, so they can be done
incrementally without one large risky edit.

## Switching

`data-theme` on `<html>`, persisted to `localStorage`, defaulting to `console`, with the
control in the dash chrome. No flash of the wrong theme on load: the attribute is set by
an inline script before first paint.
