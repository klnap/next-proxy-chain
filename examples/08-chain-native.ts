// proxy.ts (Next.js 16) or middleware.ts (Next.js 15)
import { chain as composeChain, defineHandler, next } from "@klnap/next-proxy-chain";
import { type NextRequest, NextResponse } from "next/server";

// A native Next.js handler: (request, event). No wrapper needed.
function localeRedirect(req: NextRequest) {
  if (req.nextUrl.pathname === "/") {
    return NextResponse.redirect(new URL("/en", req.url));
  }
  return NextResponse.next();
}

// Native handler with background work through event.waitUntil.
function analytics(req: NextRequest, event: { waitUntil(p: Promise<unknown>): void }) {
  event.waitUntil(Promise.resolve(req.nextUrl.pathname));
  return NextResponse.next();
}

// A rule that needs request state uses defineHandler() and a typed context.
type Session = { user?: string };
const readSession = defineHandler<Session>({
  name: "read-session",
  handler: (req, _event, session) => {
    session.user = req.cookies.get("user")?.value;
    return next();
  },
});
const requireUser = defineHandler<Session>({
  name: "require-user",
  handler: (req, _event, session) => {
    if (!session.user) return NextResponse.redirect(new URL("/login", req.url));
    return next();
  },
});

export default composeChain<Session>([
  localeRedirect,
  analytics,
  // Rules run in array order. The session must be read before a rule uses it.
  readSession,
  // Scoped tuple: the rule runs only for these paths.
  [requireUser, "/dashboard/**"],
]);
