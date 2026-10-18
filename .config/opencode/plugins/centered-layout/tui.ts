// Depends on OpenCode internals: the "session-pane" renderable id and
// renderable layout props. An OpenCode update can break this plugin. When it
// does, it warns once and leaves the default layout unchanged.

import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "local.centered-layout",
  setup(context: any) {
    const renderer: any = context.renderer
    const maxWidth = paneWidth()
    const [settings, updateSettings] = context.storage.store("settings", {
      initial: { enabled: true },
    })

    let lastPane: any = null
    let lastEnabled: boolean | null = null
    let stopped = false
    let warned = false
    let absentAt = 0

    function paneWidth(): number {
      // options.maxWidth is the pane width in columns, padding included.
      const value = Number(context.options?.maxWidth)
      return Number.isInteger(value) && value > 0 ? value : 110
    }

    function findPane(): any {
      return renderer.root?.findDescendantById?.("session-pane") ?? null
    }

    function toast(message: string) {
      context.ui.toast.show({ message, variant: "warning" })
    }

    // Warn once when a session is open but the pane is gone, so a broken
    // internal dependency is visible without spamming toasts.
    function warnIfAbsent() {
      if (context.ui.router.current()?.type !== "session") {
        absentAt = 0
        return
      }
      const now = Date.now()
      if (!absentAt) absentAt = now
      if (!warned && now - absentAt > 2000) {
        warned = true
        toast("centered-layout: session pane not found, layout unchanged")
      }
    }

    function apply() {
      if (stopped) return
      try {
        const enabled = settings.enabled !== false
        const pane = findPane()
        const row = pane?.parent
        if (!pane) {
          if (enabled) warnIfAbsent()
          return
        }
        if (pane === lastPane && enabled === lastEnabled) return
        lastPane = pane
        lastEnabled = enabled
        if (enabled) {
          // Static basis + parent justify-content centers without auto
          // margins: auto margins with flexGrow thrash the Yoga layout
          // between two geometries on wide terminals. flexShrink keeps the
          // full-width fallback when the row is under maxWidth.
          pane.flexGrow = 0
          pane.flexBasis = maxWidth
          pane.maxWidth = maxWidth
          if (row && row.justifyContent !== "center") row.justifyContent = "center"
        } else {
          pane.flexGrow = 1
          pane.flexBasis = 0
          pane.maxWidth = undefined
          if (row?.justifyContent === "center") row.justifyContent = undefined
        }
      } catch (error) {
        stopped = true
        toast("centered-layout: " + String(error) + ", layout unchanged")
      }
    }

    async function toggle() {
      const wasOn = settings.enabled !== false
      await updateSettings(function (draft: any) {
        draft.enabled = !wasOn
      })
      lastEnabled = null
      apply()
      context.ui.toast.show({
        message: wasOn ? "Centered layout off" : "Centered layout on",
        variant: "success",
      })
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "local.centered-layout.toggle",
          title: "Toggle centered layout",
          group: "Layout",
          palette: true,
          slash: { name: "center" },
          run: toggle,
        },
      ],
    }))

    const pass = { onLifecyclePass: () => apply() }
    renderer.registerLifecyclePass(pass)

    return () => {
      renderer.unregisterLifecyclePass(pass)
      const pane = lastPane
      if (pane) {
        try {
          pane.flexGrow = 1
          pane.flexBasis = 0
          pane.maxWidth = undefined
          const row = pane.parent
          if (row?.justifyContent === "center") row.justifyContent = undefined
        } catch {}
      }
    }
  },
})
