import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { VitePWA } from "vite-plugin-pwa"

// The Office previews' engines and fonts (about 52 MB) load only when an Office file opens, so they stay out of the
// precache. The app's own fonts have no hyphenated name, such as `assets/Inter.ttf`.
const officeAsset =
  /(?:^|\/)(?:(?:docx_\w+|ooxml_opc|pptx_wasm|xlsx_wasm)_bg-[\w-]+\.wasm|residentEngineWorker-[\w-]+\.js|(?:Carlito|Caladea|LiberationSans|LiberationSerif|LiberationMono|NotoSansArabic|NotoNaskhArabic|NotoSansHebrew|Gelasio|ComicRelief|Inter|Roboto|SourceSans3|DMSans|DMSerifDisplay|OpenSans|Montserrat|Poppins|Oswald|Heebo)-[\w-]+\.ttf)$/

/** Whether a built file loads on demand instead of being precached. */
export function onDemandAsset(path: string) {
  return officeAsset.test(path)
}

export function serviceWorker(directory: string) {
  return VitePWA({
    strategies: "generateSW",
    registerType: "prompt",
    injectRegister: false,
    manifest: false,
    workbox: {
      // Workbox runs after Sentry's upload and cleanup, so do not publish an unuploaded map.
      sourcemap: false,
      globDirectory: directory,
      // A PWA left suspended (iOS keeps it for weeks) never closes its old clients, so with skipWaiting off a stale
      // build survives every server upgrade until a reinstall. Activate the new worker as soon as it installs; the
      // shell's HTML is no-cache, so the next launch picks up the fresh precache. Claim stays off: clients running
      // the old build keep their old precache (lazy chunks 404 on the server) until they close.
      skipWaiting: true,
      clientsClaim: false,
      inlineWorkboxRuntime: true,
      navigateFallback: "/index.html",
      // Pairing links must reach the server so it can set the session cookie.
      navigateFallbackDenylist: [/^\/(?:api|auth)(?:\/|$)/, /^\/(?:_assets|assets)(?:\/|$)/],
      // Include lazy chunks and non-JS dependencies, not just the startup bundle.
      globPatterns: ["**/*"],
      globIgnores: ["**/*.map", "_headers", "_redirects"],
      maximumFileSizeToCacheInBytes: Number.MAX_SAFE_INTEGER,
      manifestTransforms: [
        async (entries) => ({
          manifest: await Promise.all(
            entries
              .filter((entry) => !onDemandAsset(entry.url))
              .map(async (entry) => ({
              ...entry,
              // A revision labels a cache entry; integrity rejects mixed deployments
              // and HTML fallback responses instead of installing a broken build.
              integrity: `sha256-${createHash("sha256")
                .update(await readFile(resolve(directory, entry.url)))
                .digest("base64")}`,
            })),
          ),
          warnings: [],
        }),
      ],
    },
  })
}
