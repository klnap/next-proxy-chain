import * as api from '../../src/index'

// @ts-expect-error v2 removes the deprecated chain constructor.
api.proxyChain

// @ts-expect-error v2 removes the context-first rule constructor.
api.defineProxy
