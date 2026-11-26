---
'@klnap/next-proxy-chain': major
---

Remove `proxyChain()`, `defineProxy()`, context-first handlers, manually constructed rule objects, legacy public types, and host-folder routing. Use `chain()` with native handlers or `defineHandler()` results. Scoped entries use `[handler, scope]`; chain options use `chain(entries, options)`.

Replace Map-backed context and `createContext` with immutable request metadata, generated request IDs, cooperative per-handler cancellation, and typed mutable application state. Rename chain-level `ruleTimeoutMs` to `timeout`; timeout recovery now accepts only terminal responses.
