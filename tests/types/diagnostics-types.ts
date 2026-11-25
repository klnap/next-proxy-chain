import type { NextFetchEvent, NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { chain as composeChain, defineHandler } from '../../src/index'

type Context = { user?: string }

const auth = defineHandler<Context>({
  name: 'auth',
  debug: 'verbose',
  timeout: 2000,
  rules: {
    include: ['/dashboard/**'],
    when: (request, event, context) => {
      const pathname: string = request.nextUrl.pathname
      event.waitUntil(Promise.resolve())
      return pathname.startsWith('/dashboard') && Boolean(context.user)
    },
  },
  handler: (_request, event, context) => {
    const user: string | undefined = context.user
    event.waitUntil(Promise.resolve(user))
    return NextResponse.next({ headers: new Headers({ 'x-user': user ?? '' }) })
  },
})

export const configured = composeChain([auth], {
  debug: 'compact',
  tracePath: false,
  onTrace: (trace) => {
    if (trace.outcome.type === 'redirect') {
      const status: number = trace.outcome.status
      void status
    }
    for (const handler of trace.handlers) {
      if (handler.outcome === 'skipped') {
        const reason: 'include-mismatch' | 'exclude-match' | 'when-false' = handler.reason
        void reason
      }
    }
  },
  createContext: (): Context => ({ user: 'ada' }),
})

defineHandler({
  // @ts-expect-error unsupported debug level
  debug: 'trace',
  handler: (_request: NextRequest, _event: NextFetchEvent) => undefined,
})

void configured
