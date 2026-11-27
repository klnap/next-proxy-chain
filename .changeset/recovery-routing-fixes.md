---
"@klnap/next-proxy-chain": patch
---

Fix error recovery routing: timeout, request-cancellation, and engine-level recovery now accept only terminal responses, so a recovered `NextResponse.rewrite()` or continuation no longer routes past later handlers. Ordinary errors recovered with a successful rewrite continue as a staged rewrite. Structured traces now record exactly one outcome per handler after a recovered failure. Path matchers keep each alternative's RegExp flags, so `/^\/ABC$/i` matches `/abc`.
