---
"@klnap/next-proxy-chain": patch
---

Fix terminal recovery routing. A `NextResponse.rewrite()` with a non-success status returned from timeout, request-cancellation, or engine-level recovery was classified as a terminal response that kept `x-middleware-rewrite`, so Next.js routed to the rewritten destination despite the error status. Timeout and engine-level recovery now reject any native rewrite and fail closed with `500`. Terminal responses in ordinary execution no longer carry `x-middleware-next` or `x-middleware-rewrite` to Next.js; redirects, terminal `Response` values, and the documented cancellation fallback are unchanged.
