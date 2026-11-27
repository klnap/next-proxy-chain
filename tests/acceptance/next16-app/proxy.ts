import { NextResponse } from "next/server";
import { chain, defineHandler } from "../../../src/index";

// Acceptance fixture: a timed-out gate tries to rewrite /admin into /elsewhere.
// The later gate must run; a rewrite recovery must not bypass it.
// /slow probes client disconnects: it logs cancellation events and the later handler marker.
export default chain([
  defineHandler({
    name: "slow-gate",
    rules: { include: "/admin" },
    timeout: 50,
    handle: () => new Promise<never>(() => {}),
    onError: (_err, _index, req) => NextResponse.rewrite(new URL("/elsewhere", req.url)),
  }),
  defineHandler({
    name: "deny-gate",
    rules: { include: "/admin" },
    handle: () => new Response("denied", { status: 403 }),
  }),
  defineHandler({
    name: "disconnect-probe",
    rules: { include: "/slow" },
    handle: async (req) => {
      console.log("PROBE_STARTED");
      req.signal.addEventListener("abort", () => console.log("PROBE_NATIVE_ABORTED"));
      await new Promise((resolve) => setTimeout(resolve, 2000));
      console.log(`PROBE_FINISHED aborted=${req.signal.aborted}`);
      return undefined;
    },
  }),
  defineHandler({
    name: "after-probe",
    rules: { include: "/slow" },
    handle: () => {
      console.log("LATER_HANDLER_RAN");
      return undefined;
    },
  }),
]);
