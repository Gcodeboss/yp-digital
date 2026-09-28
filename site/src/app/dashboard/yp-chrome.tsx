import Image from "next/image";
import Link from "next/link";

/**
 * Shared chrome for the YP Dash.
 *
 * The visual system is DESIGN-CONSOLE.md, not the marketing site. Five of its
 * six rules are load-bearing here, because every screen inherits them from this
 * file:
 *
 *  1. No floating cards. A region is separated from its neighbour by a 1px
 *     hairline and a step in background value (ground → panel → raised), never
 *     by an outline. A visible border means "this is a control you can click",
 *     which is why Button, SegmentedControl and Chip keep one and Panel does not.
 *  3. Every numeral is JetBrains Mono with tabular figures, so a column of
 *     numbers aligns and a value stops changing width as it updates.
 *  4. Micro-labels are Archivo, 10px, uppercase, 0.14em, at --ink-dim; values
 *     run 2-3x that at full contrast. Labels are set in Archivo rather than the
 *     mono face on purpose — if the labels are mono too, rule 3 is invisible and
 *     the numbers stop reading as the thing the screen is actually about.
 *  5. Density is the point. Rows and controls land on 24-32px and gutters are
 *     tight; whitespace is spent where the eye needs rest, not uniformly.
 *  6. Anton appears once per screen. `<Stat display />` is that gesture — see
 *     the note on Stat for why it is opt-in rather than the default.
 *
 * This is a desktop app, so the shell behaves like one: the frame is pinned to
 * the viewport and never scrolls, and scrolling happens inside whichever region
 * owns it. Side columns are clamped rather than fixed — a 1280 laptop and a 2560
 * display are both normal here, and a hard pixel width fails at one end or the
 * other.
 */
const NAV = [
  { href: "/dashboard/streams", label: "Streams" },
  { href: "/dashboard/timeline", label: "Timeline" },
  { href: "/dashboard/framing", label: "Framing" },
  { href: "/dashboard/captions", label: "Captions" },
  { href: "/dashboard/review", label: "Review" },
  { href: "/dashboard", label: "Ops" },
];

/**
 * The rail is a value step (panel on ground) closed by a single hairline, not a
 * bordered column. Items are a fixed 32px so the stack scans as a list rather
 * than as six buttons.
 *
 * The active item is the only amber thing in the frame: amber is reserved for
 * "now", and where you are is the rail's one piece of information. It is carried
 * on a 2px left rule — the inactive state holds the same 2px transparent so
 * nothing shifts sideways when the route changes.
 *
 * The label tracking is written as 0.14em rather than the 0.16em this file used
 * to carry: globals.css rewrites `tracking-[0.16em]` to 0.14em *and* forces
 * --ink-dim on it, at a specificity that beat `text-amber` and quietly greyed
 * out the active item under the console theme.
 */
export function Rail({ active }: { active: string }) {
  return (
    <nav className="flex w-[clamp(72px,5.5vw,104px)] shrink-0 flex-col items-center border-r border-line bg-panel pt-3">
      <Link href="/dashboard/streams" className="mb-3 block w-full px-3" aria-label="YP Dash home">
        <Image
          src="/brand/yanchan-logo-white.png"
          alt="Yanchan Produced"
          width={600}
          height={332}
          preload
          className="h-auto w-full opacity-80"
        />
      </Link>
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`flex h-8 w-full items-center justify-center border-l-2 font-head text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors ${
            active === item.label
              ? "border-amber bg-amber/10 text-amber"
              : "border-transparent text-ink-dim hover:bg-white/[0.03] hover:text-ink"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The app frame. Pins to the viewport height and clips its own overflow so that
 * a long list scrolls inside `Body` instead of dragging the header off screen.
 *
 * Ground is the darkest value in the system; every region above it lifts. That
 * is what carries structure now that panels have no outline.
 *
 * The theme attribute is NOT here — it sits on dashboard/layout.tsx, which also
 * covers the screens that build their own frame instead of rendering Shell.
 */
export function Shell({ active, children }: { active: string; children: React.ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden bg-ground text-ink">
      <Rail active={active} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

/**
 * The screen header. `actions` is pinned right; everything left of it can shrink
 * and truncate, so no control is ever pushed off the edge on a narrow display.
 *
 * 44px, down from 56: a header holding 28px controls does not need 14px of air
 * above and below them, and the 12px it gives back goes to the list underneath.
 * It reads as a transport bar — a lifted strip closed by a hairline — rather
 * than as another card.
 */
export function TopBar({
  title,
  children,
  actions,
}: {
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line bg-panel px-3 xl:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <ScreenTitle>{title}</ScreenTitle>
        {children}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}

/**
 * The scrolling region. `wide` pages get a max width so that a row's label and
 * its numbers stay near each other on a 2560 display instead of ending up at
 * opposite edges of the screen.
 *
 * Gutters are 12px (16 at xl) rather than a uniform 16/20. Panels no longer draw
 * an outline, so the gap between them is doing the separating and a wide one
 * reads as drift rather than as structure.
 */
export function Body({
  children,
  bleed = false,
  className = "",
}: {
  children: React.ReactNode;
  bleed?: boolean;
  className?: string;
}) {
  return (
    <div className={`min-h-0 flex-1 overflow-auto ${className}`}>
      <div
        className={
          bleed ? "h-full" : "mx-auto flex w-full max-w-[1680px] flex-col gap-3 p-3 xl:p-4"
        }
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The screen title, with the product name beside it. The name is at full
 * contrast; "YP Dash" is a micro-label at --ink-faint, because it is the one
 * piece of text on the bar that never changes and never needs reading twice.
 */
export function ScreenTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-baseline gap-2.5">
      <span className="font-head text-[14px] font-black uppercase tracking-[0.02em] text-ink">
        {children}
      </span>
      <span className="hidden font-head text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint lg:inline">
        YP Dash
      </span>
    </div>
  );
}

/**
 * The micro-label — rule 4, verbatim. Archivo rather than the mono face: mono
 * belongs to numerals, and a label that shares their face flattens the contrast
 * that makes a readout scannable.
 */
export function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-head text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
      {children}
    </span>
  );
}

/**
 * A headline figure.
 *
 * Default is mono and tabular at 24-32px — roughly 3x the micro-label beside it,
 * which is the ratio rule 4 asks for, and the alignment rule 3 asks for.
 *
 * `display` opts one figure per screen into Anton at 44-72px: rule 6's single
 * editorial gesture. It is opt-in rather than the default because every screen
 * renders Stat four to ten times, and a display face repeated ten times at one
 * size is precisely the uniformity the rule exists to prevent — one loud element
 * among quiet ones is composition; ten is noise.
 *
 * The value carries no colour of its own so it inherits. Screens wrap a Stat in
 * `text-amber` or `text-sienna` to mark a figure as live or at risk; the old
 * hardcoded `text-cream` on this span won that cascade and silently threw those
 * away.
 */
export function Stat({
  value,
  unit,
  display = false,
}: {
  value: React.ReactNode;
  unit?: string;
  display?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className={
          display
            ? "font-display text-[clamp(2.75rem,4.6vw,4.5rem)] leading-[0.86] tracking-[-0.02em]"
            : "font-mono text-[clamp(1.5rem,2.1vw,2rem)] font-medium leading-none tracking-[-0.01em] tabular-nums"
        }
      >
        {value}
      </span>
      {unit ? (
        <span className="font-head text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
          {unit}
        </span>
      ) : null}
    </div>
  );
}

/**
 * One button, four jobs. Before this each screen invented its own amber, which
 * left a toggle and a primary action looking identical on the framing screen.
 * `primary` is the one thing a screen wants you to do; `toggle` is a state you
 * flip; `ghost` is everything else.
 *
 * Buttons keep their outline deliberately: rule 1 hands the border to things you
 * can click, and now that panels have given theirs up, an outline in this UI
 * means "clickable" and nothing else. Heights are fixed at 24/28px so a row of
 * mixed controls lines up on one baseline instead of on their text.
 *
 * `danger` fills with sienna rather than rust: sienna is the token that carries
 * "needs edit / warning" everywhere else, and rust is a marketing-site colour
 * with no meaning in this system.
 */
export function Button({
  children,
  variant = "ghost",
  active = false,
  size = "md",
  className = "",
  ...rest
}: {
  variant?: "primary" | "ghost" | "toggle" | "danger";
  active?: boolean;
  size?: "sm" | "md";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border font-head font-semibold uppercase tracking-[0.06em] transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const sizes = { sm: "h-6 px-2 text-[10px]", md: "h-7 px-2.5 text-[11px]" };
  const variants = {
    primary: "border-amber bg-amber text-ground hover:border-gold hover:bg-gold",
    ghost: "border-line-strong bg-white/[0.04] text-ink hover:border-amber/60 hover:text-amber",
    danger: "border-sienna/50 bg-sienna/15 text-sienna hover:border-sienna hover:bg-sienna/25",
    toggle: active
      ? "border-amber/60 bg-amber/15 text-amber"
      : "border-line bg-transparent text-ink-dim hover:border-line-strong hover:text-ink",
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

/**
 * A set of mutually exclusive choices — 16:9 / both / 9:16, and the like.
 *
 * One outline around the group, hairlines between the segments: the control is
 * the clickable thing, the segments are divisions inside it. Labels stay mono
 * and tabular because most of them are ratios and counts.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex shrink-0 overflow-hidden rounded-md border border-line-strong"
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`h-7 border-l border-line px-2.5 font-mono text-[10.5px] tracking-[0.04em] tabular-nums transition-colors first:border-l-0 ${
            value === o.value
              ? "bg-amber text-ground"
              : "bg-transparent text-ink-dim hover:bg-white/5 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A region, not a card — rule 1. It reads as one step up from ground; the gap
 * between panels does the separating that an outline used to do.
 *
 * The border *width* is kept, at transparent, for two reasons: it holds the 1px
 * that would otherwise reflow every grid when a panel lights up, and screens
 * mark a panel as urgent or active by overriding the colour alone
 * (`border-amber/25`, `hover:border-amber/40`). Those still work, and now an
 * outline on a panel means something.
 */
export function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-transparent bg-panel ${className}`}>{children}</div>
  );
}

/** A panel with a hairline-separated header, so sections read the same everywhere. */
export function Section({
  title,
  actions,
  children,
  className = "",
  bodyClassName = "",
}: {
  title: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Panel className={`flex min-h-0 flex-col overflow-hidden ${className}`}>
      {/* 30px of header: a micro-label plus the smallest padding that still
          separates it from the first row. The hairline underneath is the only
          thing dividing header from body, and it is the full width of the
          region rather than inset, so the rule reads as structure. */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-3 py-2">
        <Label>{title}</Label>
        <div className="flex-1" />
        {actions}
      </div>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </Panel>
  );
}

/**
 * A status tag. Keeps its pill and its outline — it is small, it sits inline
 * among prose and numbers, and without an edge it would read as stray text.
 * Mono and tabular, because most chips are a count or a duration.
 */
export function Chip({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "amber" | "rust";
}) {
  const tones = {
    muted: "border-line bg-white/[0.04] text-ink-dim",
    amber: "border-amber/35 bg-amber/10 text-amber",
    rust: "border-sienna/45 bg-sienna/15 text-sienna",
  };
  return (
    <span
      className={`inline-block shrink-0 whitespace-nowrap rounded-full border px-2 py-[2px] font-mono text-[10px] tracking-[0.06em] tabular-nums ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * Says why a screen is blank and gives the one action that fixes it. This is one
 * of the few places whitespace is spent on purpose — an empty region should not
 * look like a region that failed to load.
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 py-8 text-center">
      <div className="font-head text-[12px] font-black uppercase tracking-[0.06em] text-ink">
        {title}
      </div>
      {body ? (
        <p className="max-w-[46ch] text-[12px] leading-relaxed text-ink-dim">{body}</p>
      ) : null}
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}

export function fmtTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
