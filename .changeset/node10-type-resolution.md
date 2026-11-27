---
"@klnap/next-proxy-chain": patch
---

Add top-level `main` and `types` entries so TypeScript projects that use `moduleResolution: "node"` resolve the package types. Next.js 15 generates that setting by default, and it ignored the `exports` map, so `import { chain } from "@klnap/next-proxy-chain"` failed type checking. Runtime exports and the `exports` map are unchanged.
