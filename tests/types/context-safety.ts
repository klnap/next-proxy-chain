import type { ProxyContext } from '../../src/index'
import { chain as composeChain, defineHandler, next } from '../../src/index'

declare function assertProxyContext(ctx: ProxyContext): void

const defaultChain = composeChain([
  defineHandler({
    handler: (_req, _event, ctx) => {
      assertProxyContext(ctx)
      return next()
    },
  }),
])
void defaultChain

type UserCtx = { user: string }

const typedChain = composeChain(
  [
    defineHandler<UserCtx>({
      handler: (_req, _event, ctx) => {
        const _user: string = ctx.user
        return next()
      },
    }),
  ],
  { createContext: (): UserCtx => ({ user: 'ada' }) }
)
void typedChain

// @ts-expect-error custom TContext requires createContext
composeChain<{ user: string }>([defineHandler({ handler: () => next() })])
