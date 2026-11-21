export * as SessionIdleCompaction from "./idle-compaction.js"

import { Clock, Context, DateTime, Duration, Effect, FiberMap, Layer, Option, Stream } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Session } from "@opencode/schema/session"
import { Agent } from "../agent.js"
import { Bus } from "../bus.js"
import { Config } from "../config.js"
import { Flag } from "../flag.js"
import { LocationServiceMap } from "../location-service-map.js"
import { SessionCompaction } from "./compaction.js"
import { SessionContext } from "./context.js"
import { SessionEvent } from "./event.js"
import { SessionExecution } from "./execution.js"
import { SessionInbox } from "./inbox.js"
import { SessionMessage } from "./message.js"
import { SessionPresence } from "./presence.js"
import { SessionRunnerModel } from "./runner/model.js"
import { SessionStore } from "./store.js"
import { WarmingPlugin } from "../plugin/warming.js"

// How far before cache expiry the timer fires. Must stay above SessionCompaction.CACHE_MARGIN so the fire
// moment is inside the warm window; the cache clock (anchor, or a warming handoff), not time_idle, drives it.
const FIRE_MARGIN = Duration.seconds(90)

/**
 * The history/model firing laws, shared by the scheduler and the runner's delivery re-check. Returns the
 * cache anchor, lifetime, and effective cache clock when every law holds, undefined otherwise.
 */
export const historyLaws = (input: {
  readonly session: Session.Info
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly model: SessionRunnerModel.Resolved
  readonly settings: SessionCompaction.Settings
  readonly now: number
  readonly warming: boolean
  /** The warming handoff clock (last keep-alive sent, epoch millis); the only cache clock a warming Session has. */
  readonly handoff?: number
}) => {
  const ttl = input.model.cache?.ttl
  // Only an explicit TTL gives a known cache clock.
  if (!ttl || input.model.compaction?.type === "native" || !input.settings.auto) return undefined
  const anchor = SessionCompaction.cacheAnchor(input.messages, input.model.ref)
  if (anchor?.type !== "assistant" || !anchor.tokens) return undefined
  const lifetime = SessionCompaction.cacheLifetime(ttl)
  // A warming-configured Session keeps its cache alive with pings that never move the durable anchor, so it is
  // eligible only through a handoff, on the keep-alive clock. Without one, warming owns the Session entirely.
  const clock = input.warming ? input.handoff : DateTime.toEpochMillis(anchor.time.created)
  if (clock === undefined) return undefined
  if (input.now - clock > lifetime - SessionCompaction.CACHE_MARGIN) return undefined

  const estimate = SessionCompaction.estimatePrompt({
    session: input.session,
    messages: input.messages,
    model: input.model,
    agent: { id: Agent.defaultID, info: Agent.Info.default(Agent.defaultID) },
    initial: [],
    tools: { definitions: [], execute: () => Effect.die("idle compaction estimates without tools") },
  })
  if (estimate.measured + estimate.estimated < input.settings.idleMinTokens) return undefined

  // Once per idle epoch: a completed or failed compaction since the latest user input blocks another,
  // so even a fast provider failure that leaves the anchor warm cannot loop.
  const lastUser = input.messages.findLastIndex((message) => message.type === "user")
  if (
    input.messages.slice(lastUser + 1).some((message) => message.type === "compaction" && message.status !== "running")
  )
    return undefined

  return { anchor, lifetime, clock }
}

export interface Interface {
  /** Re-arms the idle timer from durable state. Cheap process-local checks run before any Location load. */
  readonly touch: (sessionID: Session.ID) => Effect.Effect<void>
  readonly cancel: (sessionID: Session.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionIdleCompaction") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const presence = yield* SessionPresence.Service
    const inbox = yield* SessionInbox.Service
    const execution = yield* SessionExecution.Service
    const locations = yield* LocationServiceMap.Service
    const bus = yield* Bus.Service
    const timers = yield* FiberMap.make<Session.ID>()
    // Warming handoff clocks: sessionID → the last keep-alive sent (epoch millis). Process-local like the timers;
    // a new execution or deletion drops the entry, and the epoch check strands any item admitted from a stale one.
    const handoffs = new Map<Session.ID, number>()

    const cancel = Effect.fnUntraced(function* (sessionID: Session.ID) {
      handoffs.delete(sessionID)
      yield* FiberMap.remove(timers, sessionID)
    })

    /** The Location-scoped firing laws: flag, model, cache clock, size floor, and epoch. */
    const atLocation = Effect.fn("SessionIdleCompaction.atLocation")(function* (
      session: Session.Info,
      messages: ReadonlyArray<SessionMessage.Info>,
    ) {
      const flags = yield* Flag.Service
      if (!(yield* flags.enabled("idle_compaction"))) return undefined
      const compaction = yield* SessionCompaction.Service
      const context = yield* SessionContext.Service
      const selected = yield* context.select(session.id).pipe(Effect.option)
      if (Option.isNone(selected)) return undefined
      const model = yield* context
        .resolveModel(selected.value.session, { kind: "primary", agent: selected.value.agent.id })
        .pipe(Effect.option)
      if (Option.isNone(model)) return undefined
      const config = yield* Effect.serviceOption(Config.Service)
      const entries = Option.isSome(config) ? yield* config.value.entries() : []
      const warming = model.value.cache?.warming ?? Config.latest(entries, "warming")
      return historyLaws({
        session,
        messages,
        model: model.value,
        settings: compaction.settings(),
        now: yield* Clock.currentTimeMillis,
        warming: Boolean(warming),
        handoff: handoffs.get(session.id),
      })
    })

    /** The firing laws. Returns the admission inputs when every law holds, undefined otherwise. */
    const eligible = Effect.fn("SessionIdleCompaction.eligible")(function* (sessionID: Session.ID) {
      if (!(yield* presence.present(sessionID))) return undefined
      const session = yield* store.get(sessionID)
      if (!session || session.parentID || session.time.archived || session.revert) return undefined
      if (yield* execution.isActive(sessionID)) return undefined
      if ((yield* inbox.list(sessionID)).some((item) => item.type === "user" || item.type === "synthetic"))
        return undefined

      const messages = yield* store.context(sessionID).pipe(Effect.orElseSucceed(() => []))
      const placed = yield* Effect.scoped(
        Effect.provide(atLocation(session, messages), locations.get(session.location)),
      ).pipe(Effect.option)
      if (Option.isNone(placed) || placed.value === undefined) return undefined
      return { session, ...placed.value }
    })

    const fire = Effect.fn("SessionIdleCompaction.fire")(function* (sessionID: Session.ID, due: number) {
      const now = yield* Clock.currentTimeMillis
      yield* Effect.sleep(Duration.millis(Math.max(0, due - now)))
      const ready = yield* eligible(sessionID)
      if (!ready) return
      yield* inbox.admitCompaction({
        id: SessionMessage.ID.create(),
        sessionID,
        delivery: "queue",
        payload: {
          reason: "idle",
          idle: ready.session.time.idle ? DateTime.toEpochMillis(ready.session.time.idle) : undefined,
          handoff: handoffs.get(sessionID),
        },
      })
      yield* execution.wake(sessionID)
    })

    const touch = Effect.fn("SessionIdleCompaction.touch")(function* (sessionID: Session.ID) {
      const ready = yield* eligible(sessionID)
      if (!ready) return
      const due = ready.clock + ready.lifetime - Duration.toMillis(FIRE_MARGIN)
      yield* FiberMap.run(timers, sessionID, fire(sessionID, due))
    })

    // Terminal executions arm the timer; new work and deletion cancel it. A shutdown interruption preserves
    // the execution claim for startup recovery, so it must not arm. A warming handoff records the keep-alive
    // clock and arms from it, so a Session whose warming window just ended compacts while its cache is still warm.
    yield* bus
      .subscribe([
        SessionEvent.Execution.Succeeded,
        SessionEvent.Execution.Failed,
        SessionEvent.Execution.Interrupted,
        SessionEvent.Execution.Started,
        SessionEvent.Deleted,
        WarmingPlugin.Handoff,
      ])
      .pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            const sessionID = event.data.sessionID
            if (event.type === "session.execution.started" || event.type === "session.deleted")
              return yield* cancel(sessionID)
            if (event.type === "session.warming.handoff") {
              handoffs.set(sessionID, event.data.sent)
              return yield* touch(sessionID)
            }
            if (event.type === "session.execution.interrupted" && event.data.reason === "shutdown") return
            yield* touch(sessionID)
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )

    return Service.of({ touch, cancel })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [
    SessionStore.node,
    SessionPresence.node,
    SessionInbox.node,
    SessionExecution.node,
    LocationServiceMap.node,
    Bus.node,
  ],
})
