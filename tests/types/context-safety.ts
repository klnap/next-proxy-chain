import type { ProxyContext } from '../../src/index'
import { defineProxy, next, proxyChain } from '../../src/index'

declare function assertProxyContext(ctx: ProxyContext): void

const defaultChain = proxyChain([
  defineProxy((_req, ctx) => {
    assertProxyContext(ctx)
    return next()
  }),
])
void defaultChain

type UserCtx = { user: string }

const typedChain = proxyChain({ createContext: (): UserCtx => ({ user: 'ada' }) }, [
  defineProxy<UserCtx>((_req, ctx) => {
    const _user: string = ctx.user
    return next()
  }),
])
void typedChain

// @ts-expect-error custom TContext requires createContext
proxyChain<{ user: string }>([defineProxy(() => next())])
