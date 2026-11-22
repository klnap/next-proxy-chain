import { defineProxy, next, proxyChain } from '@klnap/next-proxy-chain'

type RequestState = {
  requestId: string
  locale?: string
}

// Context is created once per request and shared by every rule that runs for it.
const trackRequest = defineProxy<RequestState>('track-request', (req, ctx) => {
  ctx.requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()
  return next({ request: { 'x-request-id': ctx.requestId } })
})

const detectLocale = defineProxy<RequestState>('detect-locale', (req, ctx) => {
  ctx.locale = req.headers.get('accept-language')?.startsWith('pl') ? 'pl' : 'en'
  return next()
})

export default proxyChain(
  {
    // A custom context type needs a factory. Without it, the context is a Map.
    createContext: (): RequestState => ({ requestId: '' }),
  },
  [trackRequest, detectLocale]
)
