import { chain as composeChain, defineHandler, next } from "@klnap/next-proxy-chain";

type RequestState = {
  locale?: string;
};

const detectLocale = defineHandler<RequestState>({
  name: "detect-locale",
  handler: (req, _event, ctx) => {
    ctx.locale = req.headers.get("accept-language")?.startsWith("pl") ? "pl" : "en";
    return next({ request: { "x-request-id": ctx.requestId } });
  },
});

export default composeChain([detectLocale]);
