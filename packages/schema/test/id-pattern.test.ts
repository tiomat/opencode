import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Artifact } from "../src/artifact.js"
import { Event } from "../src/event.js"
import { Form } from "../src/form.js"
import { Permission } from "../src/permission.js"
import { Pty } from "../src/pty.js"
import { Schedule } from "../src/schedule.js"
import { startingWith } from "../src/schema.js"
import { SessionID } from "../src/session-id.js"
import { SessionMessage } from "../src/session-message.js"
import { Shell } from "../src/shell.js"
import { WorkspaceID } from "../src/workspace-id.js"

// Providers such as Alibaba DashScope enforce JSON Schema `pattern` with full-match
// semantics when constraining generation, so a prefix-only pattern like "^ses"
// truncates every generated value to the prefix. Simulate that reading here.
const fullMatch = (pattern: string, value: string) => new RegExp(`^(?:${pattern})$`).test(value)

const patternOf = (schema: Schema.Top): string => {
  const document = Schema.toJsonSchemaDocument(schema)
  const root = document.schema as { $ref?: string; pattern?: string }
  const resolved = root.$ref?.startsWith("#/$defs/")
    ? (document.definitions[root.$ref.slice("#/$defs/".length)] as { pattern?: string })
    : root
  if (typeof resolved?.pattern !== "string") throw new Error("expected a string pattern in the JSON schema")
  return resolved.pattern
}

describe("ID patterns", () => {
  const cases = [
    ["SessionID", SessionID],
    ["WorkspaceID", WorkspaceID],
    ["Event.ID", Event.ID],
    ["Artifact.ID", Artifact.ID],
    ["Permission.ID", Permission.ID],
    ["Shell.ID", Shell.ID],
    ["Form.ID", Form.ID],
    ["Pty.ID", Pty.ID],
    ["SessionMessage.ID", SessionMessage.ID],
    ["Schedule.ID", Schedule.ID],
  ] as const

  test.each(cases)("%s matches its own generated ID under full-match semantics", (_name, schema) => {
    expect(fullMatch(patternOf(schema), schema.create())).toBe(true)
  })

  test.each(cases)("%s keeps prefix validation", (_name, schema) => {
    const id = schema.create()
    expect(Schema.is(schema)(id)).toBe(true)
    expect(Schema.is(schema)("not-" + id)).toBe(false)
  })
})

describe("startingWith", () => {
  test("accepts any continuation, including newlines", () => {
    const schema = startingWith("ses")
    expect(Schema.is(schema)("ses")).toBe(true)
    expect(Schema.is(schema)("ses_abc")).toBe(true)
    expect(Schema.is(schema)("ses\nabc")).toBe(true)
    expect(Schema.is(schema)("sess")).toBe(true)
    expect(Schema.is(schema)("ase")).toBe(false)
    expect(Schema.is(schema)("")).toBe(false)
  })

  test("treats regex metacharacters in the prefix as literals", () => {
    const schema = startingWith("a.b")
    expect(Schema.is(schema)("a.bx")).toBe(true)
    expect(Schema.is(schema)("axbx")).toBe(false)
    expect(fullMatch(patternOf(schema), "a.bx")).toBe(true)
  })
})