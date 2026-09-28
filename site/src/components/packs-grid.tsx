"use client";

import Image from "next/image";
import { PACKS } from "@/lib/content";
import { useStore } from "./store-provider";

export function PacksGrid() {
  const { add } = useStore();
  return (
    <div className="grid gap-6 md:grid-cols-3">
      {PACKS.map((p) => (
        <div
          key={p.id}
          className="group flex flex-col overflow-hidden border border-white/8 bg-charcoal transition-colors hover:border-amber/40"
        >
          <div className="relative aspect-[16/10] overflow-hidden">
            <Image
              src={p.art}
              alt={p.title}
              fill
              sizes="(max-width:768px) 100vw, 420px"
              className="object-cover transition-transform duration-700 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
          </div>
          <div className="flex flex-1 flex-col p-5">
            <h3 className="font-head text-lg font-bold text-cream">
              {p.title}
            </h3>
            <p className="mt-1 font-mono text-[0.7rem] uppercase tracking-wider text-amber">
              {p.count}
            </p>
            <p className="mt-3 flex-1 text-sm leading-relaxed text-warmgray">
              {p.blurb}
            </p>
            <button
                onClick={() =>
                  add({
                    key: `${p.id}:pack`,
                    beatId: p.id,
                    title: p.title,
                    license: "Sample Pack",
                    price: p.price,
                    art: p.art,
                  })
                }
                className="mt-5 inline-flex items-center justify-center gap-2 rounded-[4px] bg-amber py-3 font-head text-xs font-bold uppercase tracking-widest text-void transition-transform hover:scale-[1.02]"
              >
              Add to cart · ${p.price}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
