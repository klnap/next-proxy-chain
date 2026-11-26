import type { NextRequest } from "next/server";

export type RequestMetadata = {
  readonly requestId: string;
  readonly startedAt: number;
  readonly elapsedMs: number;
  readonly originalUrl: string;
  readonly originalPathname: string;
  readonly originalHostname: string;
};

type ApplicationContext<TContext extends object> = string extends keyof TContext
  ? never
  : Omit<Partial<TContext>, keyof RequestMetadata | "signal">;

export type HandlerContext<TContext extends object = object> = RequestMetadata &
  ApplicationContext<TContext> & {
    readonly signal: AbortSignal;
  };

const RESERVED_CONTEXT_KEYS = new Set<PropertyKey>([
  "requestId",
  "startedAt",
  "elapsedMs",
  "originalUrl",
  "originalPathname",
  "originalHostname",
  "signal",
]);

export function createRequestMetadata(
  request: NextRequest,
  requestId: string,
  startedAt: number,
  invocationStartedAt: number,
): RequestMetadata {
  const metadata = Object.create(null) as RequestMetadata;
  Object.defineProperties(metadata, {
    requestId: { value: requestId, enumerable: true },
    startedAt: { value: startedAt, enumerable: true },
    elapsedMs: {
      get: () => performance.now() - invocationStartedAt,
      enumerable: true,
    },
    originalUrl: { value: request.url, enumerable: true },
    originalPathname: { value: request.nextUrl.pathname, enumerable: true },
    originalHostname: { value: request.nextUrl.hostname, enumerable: true },
  });
  return metadata;
}

export function createApplicationState(): object {
  return Object.create(null) as object;
}

export function createHandlerContext<TContext extends object>(
  metadata: RequestMetadata,
  applicationState: object,
  signal: AbortSignal,
): HandlerContext<TContext> {
  const target = Object.create(null) as object;
  Object.defineProperties(target, {
    requestId: { value: metadata.requestId, enumerable: true },
    startedAt: { value: metadata.startedAt, enumerable: true },
    elapsedMs: { get: () => metadata.elapsedMs, enumerable: true },
    originalUrl: { value: metadata.originalUrl, enumerable: true },
    originalPathname: { value: metadata.originalPathname, enumerable: true },
    originalHostname: { value: metadata.originalHostname, enumerable: true },
    signal: { value: signal, enumerable: true },
  });

  return new Proxy(target, {
    get(view, property) {
      return Reflect.has(view, property)
        ? Reflect.get(view, property, view)
        : Reflect.get(applicationState, property, applicationState);
    },
    set(_view, property, value) {
      if (RESERVED_CONTEXT_KEYS.has(property)) return false;
      return Reflect.set(applicationState, property, value, applicationState);
    },
    deleteProperty(_view, property) {
      if (RESERVED_CONTEXT_KEYS.has(property)) return false;
      return Reflect.deleteProperty(applicationState, property);
    },
    defineProperty(_view, property, descriptor) {
      if (RESERVED_CONTEXT_KEYS.has(property)) return false;
      return Reflect.defineProperty(applicationState, property, {
        ...descriptor,
        configurable: true,
      });
    },
    getPrototypeOf() {
      return null;
    },
    setPrototypeOf() {
      return false;
    },
    has(view, property) {
      return Reflect.has(view, property) || Reflect.has(applicationState, property);
    },
    ownKeys(view) {
      return [...new Set([...Reflect.ownKeys(view), ...Reflect.ownKeys(applicationState)])];
    },
    getOwnPropertyDescriptor(view, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(view, property);
      if (descriptor) return descriptor;
      const applicationDescriptor = Reflect.getOwnPropertyDescriptor(applicationState, property);
      return applicationDescriptor ? { ...applicationDescriptor, configurable: true } : undefined;
    },
    preventExtensions() {
      return false;
    },
  }) as HandlerContext<TContext>;
}
