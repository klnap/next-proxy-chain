---
"@klnap/next-proxy-chain": patch
---

Fix host scope matching when several host regular expressions are declared together. Each alternative is now compiled independently, so backreferences in one alternative no longer bind to another alternative's capture group.
