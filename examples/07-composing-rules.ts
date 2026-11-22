import { defineProxy, next, path, proxyChain } from '@klnap/next-proxy-chain'

type Ctx = { requestId: string }

// Each integration exports a factory. The app decides where and in which order it runs.
export function createRequestIdRule() {
  return defineProxy<Ctx>('request-id', (req, ctx) => {
    ctx.requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()
    return next({ request: { 'x-request-id': ctx.requestId } })
  })
}

export function createLocaleRule(locales: readonly string[], fallback: string) {
  return defineProxy<Ctx>('locale', (req) => {
    const first = req.nextUrl.pathname.split('/')[1] ?? ''
    if (locales.includes(first)) return next()
    return next({ headers: { 'content-language': fallback } })
  })
}

export function createMaintenanceRule(enabled: boolean) {
  return defineProxy<Ctx>('maintenance', () => {
    if (enabled) return new Response('Maintenance', { status: 503 })
    return next()
  })
}

const requestId = createRequestIdRule()
const locale = createLocaleRule(['en', 'pl'], 'en')
const maintenance = createMaintenanceRule(false)

export default proxyChain(
  {
    createContext: (): Ctx => ({ requestId: '' }),
  },
  [requestId, maintenance, locale({ include: path('/**') })]
)
