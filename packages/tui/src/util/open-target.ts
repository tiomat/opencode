import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { openPath, openUrl } from "@opencode/util/open"

// Fork-local (`vp/local`): a markdown link to a local file used to be a dead end. `openUrl` accepts
// only http(s), so `[report.md](report.md)` failed with "Only http and https links can be opened in
// the browser". Model output links file paths all the time, so a click now opens the file in the app
// named by `OPENCODE_FILE_APP` (Zed by default) and falls back to the system handler for formats the
// app cannot open. Set the variable to an empty string to always use the system handler.
const APP = process.env.OPENCODE_FILE_APP ?? "Zed"

export type LinkTarget =
  | { kind: "url"; value: string }
  | { kind: "file"; value: string }
  // An in-document anchor: there is nothing to open.
  | { kind: "ignore" }
  | { kind: "unsupported"; value: string }

/**
 * Decides what a clicked transcript link points at. Relative file links resolve against the session
 * directory: a link was written in its project, not in whatever directory the TUI happened to start in.
 */
export function resolveLinkTarget(target: string, directory?: string): LinkTarget {
  const input = target.trim()
  const url = URL.canParse(input) ? new URL(input) : undefined
  if (url?.protocol === "http:" || url?.protocol === "https:") return { kind: "url", value: url.href }
  if (url?.protocol === "file:") {
    try {
      return { kind: "file", value: fileURLToPath(url) }
    } catch {
      return { kind: "unsupported", value: target }
    }
  }
  if (url) return { kind: "unsupported", value: target }
  const file = localPath(input)
  if (file === undefined) return { kind: "ignore" }
  return { kind: "file", value: path.resolve(directory ?? process.cwd(), file) }
}

export async function openTarget(target: string, directory?: string) {
  const resolved = resolveLinkTarget(target, directory)
  switch (resolved.kind) {
    case "ignore":
      return
    case "unsupported":
      throw new Error(`Only http(s) links and local files can be opened: ${resolved.value}`)
    case "url":
      return openUrl(resolved.value)
    case "file":
      return openFile(resolved.value)
  }
}

async function openFile(file: string) {
  // A transcript can outlive its files, and a stale link should say so instead of opening a parent folder.
  if (!existsSync(file)) throw new Error(`File not found: ${file}`)
  if (!APP) return openPath(file)
  try {
    return await openPath(file, APP)
  } catch {
    return openPath(file)
  }
}

// Markdown destinations may carry a fragment after the path, percent escapes, and the `~/` shorthand.
function localPath(target: string) {
  const withoutFragment = target.split("#")[0]!
  const decoded = decode(withoutFragment)
  if (decoded === "") return undefined
  if (decoded === "~") return os.homedir()
  if (decoded.startsWith("~/")) return path.join(os.homedir(), decoded.slice(2))
  return decoded
}

function decode(target: string) {
  try {
    return decodeURIComponent(target)
  } catch {
    return target
  }
}
