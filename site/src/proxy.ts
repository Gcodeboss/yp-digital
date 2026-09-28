import { NextResponse } from "next/server";
import { INTERNAL_TOOLS_ENABLED } from "@/lib/internal-only";

// The ops dashboard reads the brand-deals CRM. Seal it at the edge so the
// public deploy returns a real 404 rather than rendering anything at all.
export default function proxy() {
  if (INTERNAL_TOOLS_ENABLED) return NextResponse.next();
  return new NextResponse("Not found", {
    status: 404,
    headers: { "content-type": "text/plain", "x-robots-tag": "noindex" },
  });
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/ops-dashboard/:path*",
    "/api/clip/:path*",
  ],
};
