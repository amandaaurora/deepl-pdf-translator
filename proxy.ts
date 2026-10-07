import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, isAuthConfigured, verifySessionToken } from "@/lib/auth";

// Paths reachable without signing in.
const PUBLIC_PATHS = [
  "/login",
  "/api/login",
  "/api/passkeys/login/options",
  "/api/passkeys/login/verify",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();

  const isApi = pathname.startsWith("/api/");

  // Fail closed: if the password hasn't been set up, nothing is reachable.
  if (!isAuthConfigured()) {
    const message =
      "Site password not configured. Set SITE_PASSWORD and SESSION_SECRET.";
    return isApi
      ? NextResponse.json({ error: message }, { status: 503 })
      : new NextResponse(message, { status: 503 });
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token)) return NextResponse.next();

  if (isApi) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const loginUrl = new URL("/login", request.url);
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
