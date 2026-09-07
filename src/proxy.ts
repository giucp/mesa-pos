import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/constants";

const PROTECTED = [
  "/floor",
  "/table",
  "/menu",
  "/check",
  "/cuenta",
  "/pay",
  "/split",
  "/kds",
  "/reports",
  "/staff",
  "/settings",
  "/sin-acceso",
  "/app",
];

function noStore(res: NextResponse) {
  res.headers.set("Cache-Control", "private, no-store, no-cache, must-revalidate");
  res.headers.set("CDN-Cache-Control", "private, no-store");
  res.headers.set("Vercel-CDN-Cache-Control", "private, no-store");
  return res;
}

export function proxy(req: NextRequest) {
  const session = req.cookies.get(SESSION_COOKIE)?.value;
  const path = req.nextUrl.pathname;
  const locked = PROTECTED.some((p) => path === p || path.startsWith(`${p}/`));
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-mesa-path", `${path}${req.nextUrl.search}`);

  if (locked && !session) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    url.searchParams.set("aviso", "sesion");
    url.searchParams.set("next", `${path}${req.nextUrl.search}`);
    return noStore(NextResponse.redirect(url));
  }

  return noStore(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  matcher: [
    "/",
    "/floor",
    "/floor/:path*",
    "/table",
    "/table/:path*",
    "/menu",
    "/menu/:path*",
    "/check",
    "/check/:path*",
    "/cuenta",
    "/cuenta/:path*",
    "/pay",
    "/pay/:path*",
    "/split",
    "/split/:path*",
    "/kds",
    "/kds/:path*",
    "/reports",
    "/reports/:path*",
    "/staff",
    "/staff/:path*",
    "/settings",
    "/settings/:path*",
    "/sin-acceso",
    "/app",
    "/app/:path*",
  ],
};
