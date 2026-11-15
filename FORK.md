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
