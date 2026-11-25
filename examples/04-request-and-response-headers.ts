import { chain as composeChain, defineHandler, next } from '@klnap/next-proxy-chain'

// `request` changes what downstream rules and the route handler receive.
// `headers` changes what the browser receives.
const tagUser = defineHandler({
  name: 'tag-user',
  handler: () =>
    next({
      request: { 'x-user-tier': 'free' },
      headers: { 'cache-control': 'no-store' },
    }),
})

// Cookie and Authorization cannot be set through `request` by default.
const tryToOverrideCookie = defineHandler({
  name: 'try-override-cookie',
  handler: () => next({ request: { cookie: 'session=attacker' } }),
})

export default composeChain([tagUser, tryToOverrideCookie])
