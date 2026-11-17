import { describe, expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { resolveLinkTarget } from "../src/util/open-target"

describe("resolveLinkTarget", () => {
  test("keeps http and https links for the browser", () => {
    expect(resolveLinkTarget("https://opencode.ai/docs", "/project")).toEqual({
      kind: "url",
      value: "https://opencode.ai/docs",
    })
    expect(resolveLinkTarget("http://127.0.0.1:49374/app", "/project")).toEqual({
      kind: "url",
      value: "http://127.0.0.1:49374/app",
    })
  })

  test("resolves relative file links against the session directory", () => {
    expect(resolveLinkTarget("MPSM-22223_itogovaya_spravka.md", "/project")).toEqual({
      kind: "file",
      value: "/project/MPSM-22223_itogovaya_spravka.md",
    })
    expect(resolveLinkTarget("docs/report.md", "/project")).toEqual({
      kind: "file",
      value: "/project/docs/report.md",
    })
    expect(resolveLinkTarget("../README.md", "/project/work")).toEqual({
      kind: "file",
      value: "/project/README.md",
    })
  })

  test("keeps absolute paths and file URLs", () => {
    expect(resolveLinkTarget("/tmp/report.md", "/project")).toEqual({ kind: "file", value: "/tmp/report.md" })
    expect(resolveLinkTarget("file:///tmp/report.md", "/project")).toEqual({ kind: "file", value: "/tmp/report.md" })
  })

  test("expands the home shorthand", () => {
    expect(resolveLinkTarget("~/report.md", "/project")).toEqual({
      kind: "file",
      value: path.join(os.homedir(), "report.md"),
    })
  })

  test("drops the fragment and decodes percent escapes", () => {
    expect(resolveLinkTarget("docs/my%20report.md#summary", "/project")).toEqual({
      kind: "file",
      value: "/project/docs/my report.md",
    })
  })

  test("ignores links that only point inside the document", () => {
    expect(resolveLinkTarget("#summary", "/project")).toEqual({ kind: "ignore" })
    expect(resolveLinkTarget("", "/project")).toEqual({ kind: "ignore" })
  })

  test("refuses schemes that are neither http(s) nor files", () => {
    expect(resolveLinkTarget("javascript:alert(1)")).toEqual({ kind: "unsupported", value: "javascript:alert(1)" })
    expect(resolveLinkTarget("mailto:someone@example.com")).toEqual({
      kind: "unsupported",
      value: "mailto:someone@example.com",
    })
    expect(resolveLinkTarget("ms-msdt:/id PCWDiagnostic")).toEqual({
      kind: "unsupported",
      value: "ms-msdt:/id PCWDiagnostic",
    })
  })

  test("falls back to the process working directory", () => {
    expect(resolveLinkTarget("report.md")).toEqual({ kind: "file", value: path.resolve(process.cwd(), "report.md") })
  })
})
