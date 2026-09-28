import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { RELEASES } from "@/lib/content";
import { Stagger, StaggerItem } from "./reveal";

export function DiscographyGrid() {
  return (
    <Stagger className="grid grid-cols-2 gap-x-5 gap-y-9 md:grid-cols-3">
      {RELEASES.map((r) => {
        const href = r.spotify ?? r.youtube;
        const where = r.spotify ? "Spotify" : "YouTube";
        return (
          <StaggerItem key={r.id}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="group block"
              aria-label={`${r.title}, open on ${where}`}
            >
              <span className="relative block aspect-square w-full overflow-hidden border border-white/8 bg-coal transition-colors duration-500 group-hover:border-amber/50">
                <Image
                  src={r.art}
                  alt={r.title}
                  fill
                  sizes="(max-width:768px) 50vw, 430px"
                  className="object-cover transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-105"
                />
                <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

                {r.tag && (
                  <span className="absolute left-3 top-3 bg-amber px-2 py-1 font-mono text-[0.62rem] font-bold uppercase tracking-[0.18em] lg:text-[0.55rem] text-void">
                    {r.tag}
                  </span>
                )}

                <span className="absolute bottom-3 right-3 flex translate-y-3 items-center gap-1.5 rounded-full bg-gold px-3.5 py-2 font-head text-[0.65rem] font-bold uppercase tracking-[0.12em] text-void opacity-0 shadow-[0_10px_30px_-8px_rgba(255,222,0,0.6)] transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100">
                  {where} <ArrowUpRight size={12} />
                </span>
              </span>

              {/* Meta sits below the art so nothing is ever covered up */}
              <span className="mt-3.5 flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate font-head text-[0.95rem] font-bold text-cream transition-colors group-hover:text-amber">
                    {r.title}
                  </span>
                  <span className="mt-1 block truncate font-mono text-[0.62rem] uppercase tracking-[0.16em] text-warmgray">
                    {r.feat
                      ? `feat. ${r.feat}`
                      : (r.kind ?? "Yanchan Produced")}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[0.62rem] tracking-[0.14em] text-warmgray">
                  {r.year}
                </span>
              </span>
            </a>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}
