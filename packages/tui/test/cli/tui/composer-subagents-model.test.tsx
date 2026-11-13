/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { afterAll, expect, test } from "bun:test"
import { onMount, Show } from "solid-js"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider, useData } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { LocationProvider } from "../../../src/context/location"
import { RouteProvider, useRoute } from "../../../src/context/route"
import { TuiAppProvider } from "../../../src/context/runtime"
import { StorageProvider } from "../../../src/context/storage"
import { ThemeProvider } from "../../../src/context/theme"
import { Composer } from "../../../src/routes/session/composer"
import { DialogProvider } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { tmpdir } from "../../fixture/fixture"
import { createApi, createEventStream, createFetch, directory, json } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const sessions = {
  parent: session("parent", "Parent"),
  "child-a": session("child-a", "Catalog model", "parent", {
    id: "qwen4-max-preview",
    providerID: "alibaba-token-plan",
    variant: "medium",
  }),
  "child-b": session("child-b", "Unknown model", "parent", {
    id: "k3.1-pro",
    providerID: "kimi-code-plan-global",
    variant: "high",
  }),
  "child-c": session("child-c", "No model", "parent"),
}

const state = await tmpdir()
afterAll(() => state[Symbol.asyncDispose]())

async function renderComposer() {
  const events = createEventStream()
  const ready = Promise.withResolvers<void>()
  let route!: ReturnType<typeof useRoute>
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/active")
      return json({ data: { "child-a": { type: "running" }, "child-b": { type: "running" } } })
    if (url.pathname === "/api/model")
      return json({
        location: { directory },
        data: [{ id: "qwen4-max-preview", providerID: "alibaba-token-plan", name: "Qwen4 Max Preview", variants: [] }],
      })
    const sessionID = url.pathname.match(/^\/api\/session\/([^/]+)$/)?.[1]
    if (sessionID && sessionID in sessions) return json({ data: sessions[sessionID as keyof typeof sessions] })
  }, events)

  function Content() {
    const data = useData()
    route = useRoute()
    onMount(() => {
      void Promise.all([
        data.session.sync("parent"),
        data.session.sync("child-a"),
        data.session.sync("child-b"),
        data.session.sync("child-c"),
        data.location.model.sync({ directory }),
      ])
        .then(() => wait(() => data.session.status("child-a") === "running"))
        .then(() => ready.resolve(), ready.reject)
    })
    return (
      <Show when={route.data.type === "session" ? route.data.sessionID : undefined} keyed>
        {(sessionID) => <Composer sessionID={sessionID} open={true} defaultTab="subagents" onClose={() => {}} />}
      </Show>
    )
  }

  const app = await testRender(
    () => (
      <TestTuiContexts directory={directory} paths={{ state: state.path }}>
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <StorageProvider>
            <ConfigProvider config={createTuiResolvedConfig()}>
              <Keymap.Provider>
                <ClientProvider api={createApi(calls.fetch)}>
                  <DataProvider directory={process.cwd()}>
                    <LocationProvider>
                      <RouteProvider initialRoute={{ type: "session", sessionID: "parent" }}>
                        <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
                          <ToastProvider>
                            <DialogProvider>
                              <Content />
                            </DialogProvider>
                          </ToastProvider>
                        </ThemeProvider>
                      </RouteProvider>
                    </LocationProvider>
                  </DataProvider>
                </ClientProvider>
              </Keymap.Provider>
            </ConfigProvider>
          </StorageProvider>
        </TuiAppProvider>
      </TestTuiContexts>
    ),
    { width: 120, height: 20, kittyKeyboard: true },
  )
  await ready.promise
  await app.renderOnce()
  return app
}

test("subagent rows show the session model with its variant", async () => {
  const app = await renderComposer()
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Catalog model")
    expect(frame).toContain("Qwen4 Max Preview (medium)")
    expect(frame).toContain("Unknown model")
    expect(frame).toContain("kimi-code-plan-global/k3.1-pro (high)")
  } finally {
    app.renderer.destroy()
  }
})

test("subagent rows without a session model show no label", async () => {
  const app = await renderComposer()
  try {
    app.mockInput.pressKey("a", { ctrl: true })
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("No model")
    expect(frame).not.toContain("Qwen4 Max Preview")
    expect(frame).not.toContain("k3.1-pro")
  } finally {
    app.renderer.destroy()
  }
})

function session(
  id: string,
  title: string,
  parentID?: string,
  model?: { id: string; providerID: string; variant?: string },
) {
  return {
    id,
    projectID: "proj_test",
    title,
    agent: "build",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
    ...(parentID ? { parentID } : {}),
    ...(model ? { model } : {}),
  }
}

async function wait(fn: () => boolean, timeout = 2000) {
  const deadline = Date.now() + timeout
  while (!fn()) {
    if (Date.now() > deadline) throw new Error("wait timed out")
    await Bun.sleep(10)
  }
}