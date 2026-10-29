export { isNextResult, next } from './core/actions'
export { createProxyContext } from './core/context'
export { defineProxy, proxyChain } from './core/engine'
export { host, path } from './core/matching'
export { RuleTimeoutError } from './core/timeout'

export type {
  ChainLogger,
  DefinedProxy,
  Entry,
  HostMatcher,
  MergeStrategy,
  NextOptions,
  NextResult,
  OnErrorHandler,
  OnErrorResult,
  PathMatcher,
  ProxyChainOptions,
  ProxyContext,
  ProxyFn,
  ProxyPathFilter,
  ProxyRule,
  RequestHeaderPolicy,
} from './core/types'
