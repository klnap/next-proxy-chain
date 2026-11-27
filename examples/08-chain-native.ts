// proxy.ts (Next.js 16) or middleware.ts (Next.js 15)
import { chain as composeChain, defineHandler } from "@klnap/next-proxy-chain";
import { type NextRequest, NextResponse } from "next/server";

// A native Next.js handle: (request, event). No wrapper needed.
function localeRedirect(request: NextRequest) {
  if (request.nextUrl.pathname === "/") {
    return NextResponse.redirect(new URL("/en", request.url));
  }
  return NextResponse.next();
}

// Native handler with background work through event.waitUntil.
function analytics(request: NextRequest, event: { waitUntil(p: Promise<unknown>): void }) {
  event.waitUntil(Promise.resolve(request.nextUrl.pathname));
  return NextResponse.next();
}

// A rule that needs request state uses defineHandler() and a typed context.
type Session = { user?: string };
const readSession = defineHandler<Session>({
  name: "read-session",
  handle: (request, _event, context) => {
    context.user = request.cookies.get("user")?.value;
    return NextResponse.next();
  },
});
const requireUser = defineHandler<Session>({
  name: "require-user",
  rules: { include: "/dashboard/**" },
  handle: (request, _event, context) => {
    if (!context.user) return NextResponse.redirect(new URL("/login", request.url));
    return NextResponse.next();
  },
});

export default composeChain<Session>([
  localeRedirect,
  analytics,
  // Rules run in array order. The session must be read before a rule uses it.
  readSession,
  requireUser,
]);
