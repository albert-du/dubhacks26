import { NextResponse, type NextRequest } from "next/server";

/** Gives every browser an anonymous id cookie (votes, "my uploads", enrollment). No accounts. */
export function middleware(req: NextRequest) {
  if (req.cookies.get("dump_vid")) return NextResponse.next();
  const id = crypto.randomUUID();
  const headers = new Headers(req.headers);
  headers.set("cookie", [req.headers.get("cookie"), `dump_vid=${id}`].filter(Boolean).join("; "));
  const res = NextResponse.next({ request: { headers } });
  res.cookies.set("dump_vid", id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 4 * 24 * 3600, // outlives the longest (72h) Dumpster, then it's gone too
    path: "/",
  });
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|sw.js|brand/|favicon.png|icon-|apple-touch-icon.png|manifest.webmanifest|api/photon|api/cron).*)"],
};
