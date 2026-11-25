import type { NextFetchEvent, NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { chain as composeChain, defineHandler, next, path } from '../../src/index'

// Positive: a native handler needs no annotations; req and event are inferred.
export const native = composeChain([
  (req, event) => {
    const url: string = req.nextUrl.pathname
    event.waitUntil(Promise.resolve(url))
    return NextResponse.next()
  },
  async () => undefined,
])

// Positive: string, array, object and RegExp scopes all type-check in tuples.
export const scoped = composeChain([
  [(_req: NextRequest) => undefined, '/admin/**'],
  [(_req: NextRequest) => undefined, ['/a/**', '/b/**']],
  [(_req: NextRequest) => undefined, { exclude: /^\/private(\/.*)?$/ }],
  [(_req: NextRequest) => undefined, { include: path('/x/*'), exclude: '/x/login' }],
])

// Positive: a typed context rule with the matching createContext.
type Ctx = { user: string }
const withUser = defineHandler<Ctx>({
  name: 'user',
  handler: (_req, _event, ctx) => {
    const name: string = ctx.user
    return next({ headers: { 'x-user': name } })
  },
})
export const typed = composeChain([withUser], { createContext: (): Ctx => ({ user: 'ada' }) })

// Negative: a typed context rule without createContext.
// @ts-expect-error context type Ctx is not provided
export const missingContext = composeChain([withUser])

// Negative: createContext returns a type the rule does not accept.
// @ts-expect-error rule needs Ctx, createContext gives a different shape
export const wrongContext = composeChain([withUser], { createContext: () => ({ other: 1 }) })

// Negative: unknown option.
// @ts-expect-error unknown option
export const badOption = composeChain([(_req: NextRequest) => undefined], { notAnOption: true })

// Negative: scope is neither a path, a list, nor an object.
// @ts-expect-error scope must be a path matcher or an object
export const badScope = composeChain([[(_req: NextRequest) => undefined, 42]])

// Negative: a handler must return a Response, next(), or undefined.
// @ts-expect-error string is not a valid proxy result
export const badReturn = composeChain([(_req: NextRequest, _event: NextFetchEvent) => 'continue'])

// Positive: a native handler receives the typed context as its third argument.
export const nativeWithContext = composeChain(
  [
    (_req, _event, ctx) => {
      const user: string = ctx.user
      return next({ headers: { 'x-user': user } })
    },
  ],
  { createContext: (): Ctx => ({ user: 'ada' }) }
)

// Negative: a native handler that declares a different context type.
// @ts-expect-error handler expects a number where createContext gives a string
export const wrongNativeContext = composeChain(
  [(_req: NextRequest, _event: NextFetchEvent, _ctx: { user: number }) => undefined],
  { createContext: (): Ctx => ({ user: 'ada' }) }
)

void nativeWithContext
void wrongNativeContext
void native
void scoped
void typed
void missingContext
void wrongContext
void badOption
void badScope
void badReturn
