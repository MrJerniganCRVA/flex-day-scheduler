import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;
  const isLoggedIn = !!session?.user;
  const role = session?.user?.role as Role | undefined;

  // Redirect authenticated users away from login page
  if (pathname === "/login") {
    if (isLoggedIn) {
      return NextResponse.redirect(
        new URL(getDashboardPath(role), req.url)
      );
    }
    return NextResponse.next();
  }

  // All other non-public routes require auth.
  //
  // API routes get a 401 rather than a redirect. A redirect here is actively
  // dangerous for the client: `fetch` follows it, /login answers 200 with an
  // HTML page, and `res.ok` is therefore true — so a student whose session had
  // expired saw "Signed up! ✓" (and a successful-looking cancel) for a request
  // that never reached the database. Every /api route already authenticates
  // itself and returns JSON, so the redirect was never load-bearing there.
  if (!isLoggedIn) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Your session has expired. Please sign in again." },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Role-based access control
  if (pathname.startsWith("/admin") && role !== "ADMIN") {
    return NextResponse.redirect(new URL("/unauthorized", req.url));
  }

  if (
    pathname.startsWith("/teacher") &&
    role !== "TEACHER" &&
    role !== "ADMIN"
  ) {
    return NextResponse.redirect(new URL("/unauthorized", req.url));
  }

  return NextResponse.next();
});

function getDashboardPath(role?: Role): string {
  switch (role) {
    case "ADMIN":
      return "/admin";
    case "TEACHER":
      return "/teacher";
    default:
      return "/student";
  }
}

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|unauthorized).*)",
  ],
};
