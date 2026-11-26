import { chain as composeChain, defineHandler, next, path } from "@klnap/next-proxy-chain";

type Ctx = { locale?: string };

// Each integration exports a factory. The app decides where and in which order it runs.
export function createRequestIdRule() {
  return defineHandler<Ctx>({
    name: "request-id",
    handler: (req, _event, ctx) => {
      return next({ request: { "x-request-id": ctx.requestId } });
    },
  });
}

export function createLocaleRule(locales: readonly string[], fallback: string) {
  return defineHandler<Ctx>({
    name: "locale",
    handler: (req) => {
      const first = req.nextUrl.pathname.split("/")[1] ?? "";
      if (locales.includes(first)) return next();
      return next({ headers: { "content-language": fallback } });
    },
  });
}

export function createMaintenanceRule(enabled: boolean) {
  return defineHandler<Ctx>({
    name: "maintenance",
    handler: () => {
      if (enabled) return new Response("Maintenance", { status: 503 });
      return next();
    },
  });
}

const requestId = createRequestIdRule();
const locale = createLocaleRule(["en", "pl"], "en");
const maintenance = createMaintenanceRule(false);

export default composeChain<Ctx>([requestId, maintenance, [locale, { include: path("/**") }]]);
