"use client";

import { usePathname } from "next/navigation";

export function LegacyLayoutGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLegacy = pathname === "/legacy" || pathname?.startsWith("/legacy/");
  const isDashboard =
    pathname === "/dashboard" || pathname?.startsWith("/dashboard/");

  if (isLegacy || isDashboard) {
    return null;
  }

  return <>{children}</>;
}
