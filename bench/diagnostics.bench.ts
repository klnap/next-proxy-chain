// Run: bun run bench/diagnostics.bench.ts
// Set BENCH_TERMINAL_IO=1 to measure real console output separately.
import { NextRequest, NextResponse } from 'next/server'
import { chain, defineHandler } from '../src/index'
import { formatTrace } from '../src/core/diagnostics/formatter'
import type { ChainTrace } from '../src/core/diagnostics/types'

const request = new NextRequest('https://example.com/work')
const event = { waitUntil() {} } as never
const iterations = 20_000
const handlers = [
  defineHandler({ name: 'security', handler: () => undefined }),
  defineHandler({ name: 'session', handler: () => NextResponse.next() }),
  defineHandler({ name: 'analytics', handler: () => undefined }),
]
const silent = { debug() {}, info() {}, warn() {}, error() {} }

async function measure(label: string, run: () => Promise<unknown>, count = iterations) {
  for (let i = 0; i < 1000; i++) await run()
  const started = performance.now()
  for (let i = 0; i < count; i++) await run()
  console.log(
    `${label.padEnd(24)} ${(((performance.now() - started) * 1000) / count).toFixed(2)} µs/request`
  )
}

const configurations = [
  ['debug disabled', { logger: silent }],
  ['compact', { debug: 'compact' as const, logger: silent }],
  ['detailed', { debug: 'detailed' as const, logger: silent }],
  ['verbose', { debug: 'verbose' as const, logger: silent }],
  ['structured trace', { onTrace: () => {}, logger: silent }],
] as const

for (const [name, options] of configurations) {
  const proxy = chain(handlers, options)
  await measure(name, () => proxy(request, event))
}

let lastTrace: ChainTrace | undefined
const collecting = chain(handlers, {
  onTrace: (trace) => {
    lastTrace = trace
  },
  logger: silent,
})
await collecting(request, event)
if (lastTrace) {
  for (const level of ['compact', 'detailed', 'verbose'] as const) {
    const started = performance.now()
    for (let i = 0; i < iterations; i++) formatTrace(lastTrace, level, false, true)
    console.log(
      `${`format ${level}`.padEnd(24)} ${(((performance.now() - started) * 1000) / iterations).toFixed(2)} µs/trace`
    )
  }
}

const concurrentProxy = chain(handlers, {
  debug: 'detailed',
  logger: silent,
})
const concurrency = 32
const batches = 1000
for (let i = 0; i < 100; i++) {
  await Promise.all(Array.from({ length: concurrency }, () => concurrentProxy(request, event)))
}
const concurrentStarted = performance.now()
for (let i = 0; i < batches; i++) {
  await Promise.all(Array.from({ length: concurrency }, () => concurrentProxy(request, event)))
}
console.log(
  `${'detailed concurrent'.padEnd(24)} ${(((performance.now() - concurrentStarted) * 1000) / (batches * concurrency)).toFixed(2)} µs/request (${concurrency} concurrent)`
)

if (process.env.BENCH_TERMINAL_IO === '1') {
  const terminal = chain(handlers, { debug: 'compact' })
  await measure('terminal output (10)', () => terminal(request, event), 10)
}
