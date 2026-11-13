import { Schema } from "effect"
import { descending } from "./identifier.js"
import { startingWith, statics } from "./schema.js"

export const SessionID = startingWith("ses").pipe(
  Schema.brand("SessionID"),
  Schema.annotate({ identifier: "Session.ID" }),
  statics((schema) => ({
    create: () => schema.make("ses_" + descending()),
  })),
)
export type SessionID = typeof SessionID.Type
