// Run: bun run bench/chain.bench.ts
// Measures per-request overhead of chain() versus proxyChain() on the same native handlers.
import { NextRequest, NextResponse } from 'next/server'
import { chain, proxyChain } from '../src/index'

const silent = { debug() {}, info() {}, warn() {}, error() {} }
const native = [
  (_req: NextRequest) => undefined,
  (_req: NextRequest) => NextResponse.next(),
  (_req: NextRequest) => undefined,
]
const event = { waitUntil() {} } as never

function time(label: string, fn: () => Promise<void>, iterations: number): Promise<void> {
  return (async () => {
    for (let i = 0; i < 2000; i++) await fn()
    const start = performance.now()
    for (let i = 0; i < iterations; i++) await fn()
    const perOp = ((performance.now() - start) * 1000) / iterations
    console.log(`${label.padEnd(28)} ${perOp.toFixed(2)} µs/request`)
  })()
}

const req = () => new NextRequest('http://localhost/dashboard/home')
const iterations = 50_000

const viaChain = chain(native, { logger: silent })
const viaProxyChain = proxyChain({ logger: silent }, native as never)

await time(
  'chain (3 native)',
  async () => {
    await viaChain(req(), event)
  },
  iterations
)
await time(
  'proxyChain (3 native)',
  async () => {
    await viaProxyChain(req(), event)
  },
  iterations
)

const init = performance.now()
for (let i = 0; i < 1000; i++) chain(native, { logger: silent })
console.log(
  `${'chain() init'.padEnd(28)} ${(((performance.now() - init) * 1000) / 1000).toFixed(2)} µs/call`
)
