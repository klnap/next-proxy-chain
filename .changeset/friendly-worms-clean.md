---
"@klnap/next-proxy-chain": major
---

Simplify the public runtime API to `chain()` and `defineHandler()`, rename configured handlers' executable property from `handler` to `handle`, and remove the package-specific `next()` continuation helper and tuple entries. Use native Next.js responses and request-header replacement semantics for HTTP effects.
