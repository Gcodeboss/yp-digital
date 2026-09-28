import Link from "next/link";
import type { ComponentProps, MouseEventHandler, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "play";

const base =
  "inline-flex items-center justify-center gap-2 rounded-[4px] font-head font-bold uppercase tracking-[0.06em] text-sm transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none";

const variants: Record<Variant, string> = {
  primary:
    "bg-amber text-void px-7 py-3.5 hover:bg-sienna hover:scale-[1.02] shadow-[0_8px_30px_-8px_rgba(245,136,4,0.5)]",
  secondary:
    "border border-amber text-amber px-7 py-3.5 hover:bg-amber hover:text-void",
  ghost:
    "border border-cream/25 text-cream px-7 py-3.5 hover:border-cream hover:bg-cream/5",
  play: "bg-gold text-void px-6 py-3 hover:scale-[1.05]",
};

export function Button({
  variant = "primary",
  className = "",
  href,
  external,
  children,
  onClick,
  ...props
}: {
  variant?: Variant;
  className?: string;
  href?: string;
  external?: boolean;
  children: ReactNode;
} & Omit<ComponentProps<"button">, "onClick" | "ref"> & {
    // Link-rendered buttons forward the click handler too; the untargeted
    // event type covers both cases because callers never read the element
    // off it.
    onClick?: MouseEventHandler;
  }) {
  const cls = `${base} ${variants[variant]} ${className}`;
  if (href) {
    if (external) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cls}
          onClick={onClick}
        >
          {children}
        </a>
      );
    }
    return (
      <Link href={href} className={cls} onClick={onClick}>
        {children}
      </Link>
    );
  }
  return (
    <button className={cls} onClick={onClick} {...props}>
      {children}
    </button>
  );
}

export function Eyebrow({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.25em] text-amber ${className}`}
    >
      <span className="h-px w-6 bg-amber" />
      {children}
    </span>
  );
}

export function Section({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`relative px-5 py-[clamp(4rem,10vw,8rem)] sm:px-8 ${className}`}
    >
      <div className="mx-auto w-full max-w-[1320px]">{children}</div>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  intro,
  className = "",
  as: Tag = "h2",
}: {
  eyebrow?: string;
  title: ReactNode;
  intro?: ReactNode;
  className?: string;
  /**
   * Heading level. Defaults to `h2` because most uses are a section inside a
   * page that already has its own `h1`. Pass `as="h1"` when this IS the page's
   * primary heading — /tour and /music lead with this component, and without
   * it they shipped with no `h1` at all.
   */
  as?: "h1" | "h2";
}) {
  return (
    <div className={`max-w-3xl ${className}`}>
      {eyebrow && <Eyebrow className="mb-5">{eyebrow}</Eyebrow>}
      <Tag className="font-display text-[clamp(2.2rem,6vw,4.5rem)] uppercase leading-[0.92] text-cream">
        {title}
      </Tag>
      {intro && (
        <p className="mt-5 max-w-xl text-base leading-relaxed text-warmgray sm:text-lg">
          {intro}
        </p>
      )}
    </div>
  );
}
