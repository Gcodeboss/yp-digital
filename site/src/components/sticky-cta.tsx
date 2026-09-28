"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useStore } from "./store-provider";

// Mobile-only persistent conversion bar. Hidden when cart/player would clash.
export function StickyCta() {
  const [show, setShow] = useState(false);
  const pathname = usePathname();
  const { now, count } = useStore();

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const hide = now || count > 0 || pathname?.startsWith("/store");

  return (
    <AnimatePresence>
      {show && !hide && (
        <motion.div
          initial={{ y: 80 }}
          animate={{ y: 0 }}
          exit={{ y: 80 }}
          transition={{ ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-white/10 bg-black/95 p-3 md:hidden"
        >
          <Link
            href="/store"
            className="flex-1 rounded-[4px] bg-amber py-3 text-center font-head text-sm font-bold uppercase tracking-widest text-void"
          >
            Shop Merch
          </Link>
          <Link
            href="/music"
            className="flex-1 rounded-[4px] border border-cream/30 py-3 text-center font-head text-sm font-bold uppercase tracking-widest text-cream"
          >
            Listen
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
