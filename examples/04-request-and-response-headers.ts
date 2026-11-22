import { defineProxy, next, proxyChain } from '@klnap/next-proxy-chain'

// `request` changes what downstream rules and the route handler receive.
// `headers` changes what the browser receives.
const tagUser = defineProxy('tag-user', () =>
  next({
    request: { 'x-user-tier': 'free' },
    headers: { 'cache-control': 'no-store' },
  })
)

// Cookie and Authorization cannot be set through `request` by default.
const tryToOverrideCookie = defineProxy('try-override-cookie', () =>
  next({ request: { cookie: 'session=attacker' } })
)

export default proxyChain([tagUser, tryToOverrideCookie])
