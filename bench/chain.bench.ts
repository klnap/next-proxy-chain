// Run: bun run bench/chain.bench.ts
// Measures request, context, cancellation-scope, and chain initialization overhead.
import { NextRequest, NextResponse } from "next/server";
import {
  createApplicationState,
  createHandlerContext,
  createRequestMetadata,
} from "../src/core/context";
import { runInExecutionScope } from "../src/core/timeout";
import { chain, defineHandler } from "../src/index";

const silent = { debug() {}, info() {}, warn() {}, error() {} };
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

async function timeConcurrent(
  label: string,
  fn: () => Promise<unknown>,
  iterations: number,
  concurrency: number,
): Promise<void> {
  const runBatch = (count: number) => Promise.all(Array.from({ length: count }, () => fn()));
  for (let i = 0; i < 10; i++) await runBatch(concurrency);
  const start = performance.now();
  for (let completed = 0; completed < iterations; completed += concurrency) {
    await runBatch(Math.min(concurrency, iterations - completed));
  }
  const perOp = ((performance.now() - start) * 1000) / iterations;
  console.log(`${label.padEnd(28)} ${perOp.toFixed(2)} µs/request (${concurrency} concurrent)`);
}

function timeSync(label: string, fn: () => void, iterations: number): void {
  for (let i = 0; i < 10_000; i++) fn();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const perOp = ((performance.now() - start) * 1000) / iterations;
  console.log(`${label.padEnd(28)} ${perOp.toFixed(2)} µs/op`);
}

const req = () => new NextRequest("http://localhost/dashboard/home");
const iterations = 50_000;
const request = req();
const metadata = createRequestMetadata(request, "req_benchmark", Date.now(), performance.now());
const applicationState = createApplicationState();
const signal = new AbortController().signal;

const nativeOne = chain([(_request: NextRequest) => undefined], { logger: silent });
const nativeThree = chain(
  [
    (_request: NextRequest) => undefined,
    (_request: NextRequest) => NextResponse.next(),
    (_request: NextRequest) => undefined,
  ],
  { logger: silent },
);
const defined = (readContext: boolean) =>
  chain(
    [
      defineHandler({
        name: "context",
        handle: (_request, _event, context) => {
          if (readContext) {
            void context.requestId;
            void context.signal;
          }
        },
      }),
    ],
    { logger: silent },
  );
const noContextRead = defined(false);
const withContextRead = defined(true);
const withTimeout = chain([defineHandler({ name: "timeout", handle: () => undefined })], {
  logger: silent,
  timeout: 1000,
});
const threeSequential = chain(
  [
    defineHandler({ name: "one", handle: () => undefined }),
    defineHandler({ name: "two", handle: () => undefined }),
    defineHandler({ name: "three", handle: () => undefined }),
  ],
  { logger: silent },
);

await time("native (1 handler)", async () => nativeOne(req(), event).then(() => {}), iterations);

await time("native (3 handlers)", async () => nativeThree(req(), event).then(() => {}), iterations);

await time(
  "defined (context unread)",
  async () => noContextRead(req(), event).then(() => {}),
  iterations,
);

await time(
  "defined (metadata read)",
  async () => withContextRead(req(), event).then(() => {}),
  iterations,
);

await time(
  "defined (timeout enabled)",
  async () => withTimeout(req(), event).then(() => {}),
  iterations,
);

await time(
  "defined (3 sequential)",
  async () => threeSequential(req(), event).then(() => {}),
  iterations,
);

await timeConcurrent("defined (32 concurrent)", () => noContextRead(req(), event), 10_000, 32);

const init = performance.now();
for (let i = 0; i < 1000; i++)
  chain([defineHandler({ name: "init", handle: () => undefined })], { logger: silent });
console.log(
  `${"chain() init".padEnd(28)} ${(((performance.now() - init) * 1000) / 1000).toFixed(2)} µs/call`,
);

timeSync("crypto.randomUUID()", () => void crypto.randomUUID(), iterations);
timeSync(
  "metadata + state init",
  () => {
    createRequestMetadata(req(), crypto.randomUUID(), Date.now(), performance.now());
    createApplicationState();
  },
  iterations,
);
timeSync(
  "execution context view",
  () => {
    createHandlerContext(metadata, applicationState, signal);
  },
  iterations,
);
await time(
  "scope (timeout disabled)",
  async () => {
    await runInExecutionScope(signal, 0, "bench", () => undefined);
  },
  10_000,
);
await time(
  "scope (timeout enabled)",
  async () => {
    await runInExecutionScope(signal, 1000, "bench", () => undefined);
  },
  10_000,
);
