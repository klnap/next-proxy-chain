// Run: bun run bench/chain.bench.ts
// Measures chain() request and initialization overhead for native handlers.
import { NextRequest, NextResponse } from "next/server";
import { chain, defineHandler } from "../src/index";

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const native = [
  (_req: NextRequest) => undefined,
  (_req: NextRequest) => NextResponse.next(),
  (_req: NextRequest) => undefined,
];
const event = { waitUntil() {} } as never;

function time(label: string, fn: () => Promise<void>, iterations: number): Promise<void> {
  return (async () => {
    for (let i = 0; i < 2000; i++) await fn();
    const start = performance.now();
    for (let i = 0; i < iterations; i++) await fn();
    const perOp = ((performance.now() - start) * 1000) / iterations;
    console.log(`${label.padEnd(28)} ${perOp.toFixed(2)} µs/request`);
  })();
}

const req = () => new NextRequest("http://localhost/dashboard/home");
const iterations = 50_000;

const viaChain = chain(native, { logger: silent });
const viaContext = chain(
  [
    defineHandler({
      name: "context",
      handler: (_request, _event, context) => {
        void context.requestId;
        void context.signal;
      },
    }),
  ],
  { logger: silent },
);

await time(
  "chain (3 native)",
  async () => {
    await viaChain(req(), event);
  },
  iterations,
);

await time(
  "chain (context metadata)",
  async () => {
    await viaContext(req(), event);
  },
  iterations,
);

const init = performance.now();
for (let i = 0; i < 1000; i++) chain(native, { logger: silent });
console.log(
  `${"chain() init".padEnd(28)} ${(((performance.now() - init) * 1000) / 1000).toFixed(2)} µs/call`,
);
