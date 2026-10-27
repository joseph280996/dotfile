import { Plugin } from "@opencode/plugin"

// The GLM-OCR gateway (vLLM without --enable-auto-tool-choice) rejects any
// request whose JSON body contains a "tools" key, even []. OpenCode always
// includes the key, and the model body overlay can only set it to [], not
// remove it. This plugin deletes the key from the outgoing body.
const TARGET = "zai-org/GLM-OCR"
const PROVIDERS = ["SSC-US", "SSC-UK"]

export default Plugin.define({
  id: "strip-glm-ocr-tools",
  async setup(ctx) {
    for (const providerID of PROVIDERS) {
      await ctx.session.hook(
        "http.request",
        (event) => {
          return (async () => {
            const clone = event.request.clone()
            const raw = await clone.text()
            if (!raw.includes(`"${TARGET}"`)) return
            let parsed: unknown
            try {
              parsed = JSON.parse(raw)
            } catch {
              return
            }
            if (parsed && typeof parsed === "object" && "tools" in (parsed as Record<string, unknown>)) {
              const body = parsed as Record<string, unknown>
              delete body.tools
              event.request = new Request(event.request.url, {
                method: event.request.method,
                headers: event.request.headers,
                body: JSON.stringify(body),
              })
            }
          })()
        },
        { providerID },
      )
    }
  },
})
