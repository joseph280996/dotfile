// Rebuilt 2026-10-02. Removes Anthropic `thinking.block_binding` from outgoing
// provider requests to the SSC gateway.
//
// Why: OpenCode v2.0.21 injects `block_binding:
// {prefix_mismatch_behavior:"drop_block"}` into the thinking block of every
// Claude >= 5.1 request (protocols/anthropic-messages.ts `applyThinkingBinding`
// path; verified in the 2.0.21 binary — `It()` in the anthropic-messages chunk,
// and the equivalent `Rr()` for bedrock-converse). The SSC gateway proxies AWS
// Bedrock, and Bedrock rejects the field on every thinking variant:
//   bedrock 400 ValidationException:
//     thinking.<variant>.block_binding: Extra inputs are not permitted
//
// The per-model config escape hatch
// (`compatibility.supportsThinkingBlockBinding`) is not reachable from user
// config until the upstream fix (anomalyco/opencode#52172) lands, so this hook
// strips the field at the HTTP layer instead.
//
// Scoped to host `api-ai-us.ssnc-corp.cloud` only, so first-party Anthropic
// endpoints keep the field. Registered only when the SSC provider is present.
import { Plugin } from "@opencode/plugin"

const SSC_HOST = "api-ai-us.ssnc-corp.cloud"

export default Plugin.define({
  id: "ssc-strip-blockbinding",
  async setup(ctx) {
    const ss = ctx.session
    await ss.hook(
      "http.request",
      async (event) => {
        const req: Request = event.request as unknown as Request
        if (!req || req.method !== "POST") return
        let body: string
        try {
          body = await req.clone().text()
        } catch {
          return // unreadable body: leave untouched
        }
        if (!body.includes("block_binding")) return
        let parsed: unknown
        try {
          parsed = JSON.parse(body)
        } catch {
          return // not JSON: leave untouched
        }
        if (!parsed || typeof parsed !== "object") return
        if (!new URL(req.url).host.includes(SSC_HOST)) return
        const thinking = (parsed as Record<string, unknown>).thinking
        if (!thinking || typeof thinking !== "object") return
        if (!Object.prototype.hasOwnProperty.call(thinking, "block_binding")) return
        delete (thinking as Record<string, unknown>).block_binding

        event.request = new Request(req.url, {
          method: req.method,
          headers: new Headers(req.headers), // recomputes content-length
          body: JSON.stringify(parsed),
          // Preserve the caller's cancellation: without this, aborting an
          // in-flight SSC/Bedrock thinking call would not stop the request.
          signal: req.signal,
        }) as unknown as Request
      },
      { providerID: "SSC" },
    )
  },
})
