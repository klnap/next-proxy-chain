import * as api from "../../src/index";

// @ts-expect-error v2 removes the deprecated chain constructor.
api.proxyChain;

// @ts-expect-error v2 removes the context-first rule constructor.
api.defineProxy;

// @ts-expect-error custom next() continuation export was removed.
api.next;

// @ts-expect-error matcher helpers are not part of the runtime API.
api.path;

// @ts-expect-error matcher helpers are not part of the runtime API.
api.host;

// @ts-expect-error timeout errors are not part of the runtime API.
api.RuleTimeoutError;
