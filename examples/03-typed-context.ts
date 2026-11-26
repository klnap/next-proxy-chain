import { chain as composeChain, defineHandler, next } from "@klnap/next-proxy-chain";

type RequestState = {
  requestId: string;
  locale?: string;
};

// Context is created once per request and shared by every rule that runs for it.
const trackRequest = defineHandler<RequestState>({
  name: "track-request",
  handler: (req, _event, ctx) => {
    ctx.requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    return next({ request: { "x-request-id": ctx.requestId } });
  },
});

const detectLocale = defineHandler<RequestState>({
  name: "detect-locale",
  handler: (req, _event, ctx) => {
    ctx.locale = req.headers.get("accept-language")?.startsWith("pl") ? "pl" : "en";
    return next();
  },
});

export default composeChain([trackRequest, detectLocale], {
  // A custom context type needs a factory. Without it, the context is a Map.
  createContext: (): RequestState => ({ requestId: "" }),
});
