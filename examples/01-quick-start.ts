// proxy.ts (Next.js 16) or middleware.ts (Next.js 15)
import { chain as composeChain, defineHandler } from "@klnap/next-proxy-chain";
import { NextResponse } from "next/server";

// Security headers first: a redirect from a later rule would stop the chain
// before this rule runs, and the redirect would go out without the header.
const securityHeaders = defineHandler({
  name: "security-headers",
  handle: () => {
    const response = NextResponse.next();
    response.headers.set("x-frame-options", "DENY");
    return response;
  },
});

// Presence check only. Verify the session token on the server before protecting real data.
const requireSession = defineHandler({
  name: "require-session",
  rules: { include: "/dashboard/**" },
  handle: (request) => {
    if (!request.cookies.has("session")) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return NextResponse.next();
  },
});

export default composeChain([securityHeaders, requireSession]);

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
