import { chain as composeChain, defineHandler } from "@klnap/next-proxy-chain";
import { type NextRequest, NextResponse } from "next/server";

const apiKeyCheck = defineHandler({
  name: "api-key",
  rules: { include: "/api/**", exclude: "/api/public/**" },
  handle: (request) => {
    if (!request.headers.get("x-api-key")) {
      return new Response("Unauthorized", { status: 401 });
    }
    return NextResponse.next();
  },
});

// Placeholder. Replace with a server-side session check (see docs/security.md).
// A cookie that is merely present proves nothing.
function isAdminSession(_request: NextRequest): boolean {
  return false;
}

const adminOnly = defineHandler({
  name: "admin-only",
  rules: { include: "/settings/**" },
  handle: (request) => {
    if (!isAdminSession(request)) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return NextResponse.next();
  },
});

export default composeChain([
  // `/api/**` covers /api, /api/users and /api/users/123.
  // `/api/*` would cover exactly one segment, so /api/users/123 would skip the check.
  apiKeyCheck,
  // Scope by path, not by host. The host header is client-controlled.
  adminOnly,
]);
