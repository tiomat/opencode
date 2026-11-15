# Fork workflow

This fork (`tiomat/opencode`) tracks `sst/opencode` and carries fork-local features that are not proposed upstream.

## Branches

- `dev` — pure mirror of `upstream/dev`. Fast-forward only; never commit here.
- `vp/local` — integration branch: `dev` plus every fork-local patch, merged with `--no-ff`. Build and run from here.
- Feature branches (`idle-compaction`, `vp/mobile-patches`, …) — one branch per patch, based on `dev`. Merge into `vp/local`; keep them around so a patch can be updated, reverted, or re-merged independently.

## Sync upstream

```sh
git fetch upstream dev
git push origin upstream/dev:dev        # fast-forward the mirror
git checkout vp/local
git merge dev                           # resolve conflicts once; rerere remembers resolutions
git push origin vp/local
```

`rerere.enabled` is set in this clone so repeated conflict resolutions are replayed automatically.

## Add or update a patch

```sh
git checkout -b <patch> dev             # or update an existing patch branch
# ...work, commit...
git checkout vp/local
git merge --no-ff <patch>
git push origin vp/local <patch>
```

Fork-local features stay on the fork: no upstream PRs for them. Upstream-worthy fixes go through normal PRs to `sst/opencode:dev` from a branch based on `dev`.

## Build and service

The background service (phone, TUI, web) runs the fork binary built from `vp/local`; the build channel is `vp-local` (service registration `service-vp-local.json`). The web UI is embedded into the same binary and served at `/app`.

- `~/dev/machine/bin/opencode-fork-upgrade` — sync upstream into `vp/local`, rebuild, restart the service (breaks live agent sessions).
- `~/dev/machine/bin/opencode-fork-check` — weekly reminder when the fork or the binary is stale.
- `opencode` in PATH is the `~/dev/machine/bin/opencode` wrapper around the fork binary.

Do not build the service binary from another branch: the channel guard in `packages/cli/script/build.ts` refuses it (override `OPENCODE_FORCE_CHANNEL=1` only for intentional test builds).

## Development loop

Iterate on the fork without breaking the running service:

1. Edit on `vp/local` (or a patch branch, then merge — see above).
2. Check from the package directory: `bun typecheck`, tests via `bun run script/test.ts test/<file>` (never from repo root).
3. Build: `cd packages/cli && bun run build --single` (a few minutes).
4. Verify the build landed: `grep -c '<a string your change introduced>' packages/cli/dist/cli-darwin-arm64/bin/opencode` and check the binary mtime. Builds do update the binary; when in doubt, grep it instead of blaming caching.
5. Restart safely: `~/dev/machine/bin/opencode-fork-restart` — kills stale fork TUIs, restarts the service, waits for `/app`. Never use a bare `vpa restart opencode` while a fork TUI is open (see Pitfalls).
6. Verify the service: `/app` returns 200; `OPENCODE_FLAGS` is present in the service env (`ps eww -p <pid>`); live logs via `vpa logs opencode`.

The restart breaks live agent sessions (they run through this service); clients reconnect on their own. A restart issued from inside an agent session interrupts that session's tool call — expected; verify health afterwards. A background shell containing the restart is cancelled with the service's process tree: restart in a separate foreground call, then start captures.

## Pitfalls (dead loops already hit)

- **Registration loop.** A fork TUI keeps the old build in memory. After a rebuild + restart its version mismatches the service, and ensure→replace overwrites the service registration — the agent service dies, the supervisor restarts it, the TUI replaces it again («managed service registration replaced»). `opencode-fork-restart` kills stale TUIs first; a bare `vpa restart` does not. Reopen TUIs after the restart.
- **Stale log file.** `~/.local/share/opencode/log/opencode.log` can freeze at the previous run's timestamp after a restart; grepping it shows old decisions (e.g. a flag-off that no longer exists in the binary). Use `vpa logs opencode` for live output.
- **Flag shadowing.** A project config's `experimental` block shadows the global one entirely (latest-wins). The wrapper's `OPENCODE_FLAGS` env override is the reliable enablement; verify it in the service env, not in config files.
- **Idle-compaction test never fires.** The session must be genuinely idle for ~TTL − 90s (3.5 min for a 5m TTL) with a presence lease (open tab). Any user message or assistant processing blocks it; API reads do not. Don't chat with the test session while waiting — watch `vpa logs opencode` for the `idle compaction` line and the session's compaction marker instead.
- **Debugging blind.** Before removing diagnostic logging, capture one full idle window with it; after a rebuild, confirm the marker string is in the binary. Most "it doesn't work" rounds here were stale logs or an unverified build, not the feature.

## Feature flags

Flags default on only in `local`/`dev` build channels, so fork-local features are off in `vp-local` builds unless enabled explicitly. Two gotchas:

- A project config's `experimental` block shadows the global one entirely (`Config.latest` is latest-wins per key). A repo with its own `experimental` (e.g. this repo's `part_rows`) silently drops globally set flags.
- The env override `OPENCODE_FLAGS` beats config and is immune to that shadowing. The `~/dev/machine/bin/opencode` wrapper exports `OPENCODE_FLAGS=idle_compaction` (appending to any existing value), so both the service and every client launched through the wrapper get the flag.
