import { defineProxy, next, proxyChain } from '@klnap/next-proxy-chain'

const lookupFeatureFlags = defineProxy('feature-flags', async () => {
  // Stands in for a remote call that may fail or hang.
  const response = await fetch('https://flags.example.com/config')
  if (!response.ok) throw new Error(`flags returned ${response.status}`)
  return next()
})

export default proxyChain(
  {
    // Each rule gets at most 500 ms. A rule that exceeds it goes to onError.
    ruleTimeoutMs: 500,
    // A Response stops the chain with that response.
    // Returning nothing fails closed: the request gets a 500.
    onError: () => new Response('Service unavailable', { status: 503 }),
  },
  [lookupFeatureFlags]
)
