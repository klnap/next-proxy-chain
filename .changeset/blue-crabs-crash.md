---
'@klnap/next-proxy-chain': major
---

Remove `proxyChain()`, `defineProxy()`, context-first handlers, manually constructed rule objects, and legacy public types. Use `chain()` with native handlers or `defineHandler()` results. Scoped entries use `[handler, scope]`; chain options use `chain(entries, options)`.
