export function Marquee({
  text,
  duration = 30,
  className = "",
}: {
  text: string;
  duration?: number;
  className?: string;
}) {
  const items = Array.from({ length: 4 });
  return (
    <div
      className={`flex w-full select-none overflow-hidden ${className}`}
      aria-hidden
    >
      <div
        className="flex shrink-0 animate-marquee"
        style={{ ["--marquee-dur" as string]: `${duration}s` }}
      >
        {items.map((_, i) => (
          <span
            key={i}
            className="whitespace-nowrap px-6 font-display text-[clamp(3rem,12vw,9rem)] uppercase leading-none"
          >
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}
