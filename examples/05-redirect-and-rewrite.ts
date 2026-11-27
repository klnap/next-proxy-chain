import { chain as composeChain, defineHandler } from "@klnap/next-proxy-chain";
import { NextResponse } from "next/server";

// A rewrite keeps the chain going. The next rule sees the rewritten path.
const localeRewrite = defineHandler({
  name: "locale-rewrite",
  handle: (request) => {
    const { pathname } = request.nextUrl;
    if (pathname.startsWith("/pl/")) return undefined;
    return NextResponse.rewrite(new URL(`/pl${pathname}`, request.url));
  },
});

// Sees /pl/... because the rewrite above already happened.
const plOnly = defineHandler({
  name: "pl-only",
  rules: { include: "/pl/**" },
  handle: () => {
    const response = NextResponse.next();
    response.headers.set("content-language", "pl");
    return response;
  },
});

// Redirects stop the chain: rules after this one do not run.
const legacyRedirect = defineHandler({
  name: "legacy-redirect",
  handle: (request) => {
    if (request.nextUrl.pathname === "/old") {
      return NextResponse.redirect(new URL("/new", request.url), 308);
    }
    return NextResponse.next();
  },
});

export default composeChain([legacyRedirect, localeRewrite, plOnly]);

// Without a matcher, a locale rewrite would also apply to static files and API routes.
export const config = {
  matcher: ["/((?!_next/static|_next/image|api|favicon.ico).*)"],
};
