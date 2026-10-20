# Source maps setup

Read this for every service that ships built JavaScript to browsers: Vite,
webpack, Rollup, Next.js, CRA-style apps, and anything else with a build or
minify step. Uploading source maps is a default setup step, not an opt-in.

Without maps, a browser stack reads `ht` at `/assets/index-4f3c.js:1:58213`.
Root cause analysis and fix agents cannot map that to source, and grouping
falls back to coarse, minified frames. With maps, Autter resolves each frame
to the original file, line and function before it groups the error.

Skip this only for pages that ship hand-written, unminified scripts with no
build step; say so in the hand-off.

## Check availability first

1. **CLI:** `npm view @autter/runtime-cli version`. A version means the
   package is published. An `E404` means it is not published yet. In that
   case wire nothing from this file: no devDependency, no plugin import, no
   CI step and no `upload-sourcemaps` action (it runs `npx` on the package
   and would fail). Keep any source-map upload the repo already has. Report
   **source maps as pending the `@autter/runtime-cli` release** and tell the
   user how to add them later: re-run this setup once the command prints a
   version, or follow "Pick an integration" below.
2. **Ingester:**
   `curl -s "https://otlp.autter.dev/v1/compat?features=source_map_debug_ids"`
   (or the self-hosted URL the user gave). `available: true` on
   `source_map_debug_ids` means debug ids work. Ingesters older than 1.6.0
   still accept `.js` maps by release and path; the CLI warns and uploads
   everything. Self-hosted ingesters need migration `0017-source-maps-debug-id`.
3. **Browser SDK:** debug ids need `@autter/runtime-browser` (or
   `@autter/runtime-next`) **1.6.0+** installed. Check the installed package,
   not the range. With an older SDK, maps still match by release and path, so
   the SDK `release` must equal the upload release and the URL prefix must
   match the served path.
4. **Relay:** a Node relay (`createBrowserRelayHandler`,
   `createAutterRelayRoute`) must run `@autter/runtime-node` **1.6.0+**, or it
   drops the `debugIds` the browser sends.

## Keys and release

- Every integration reads the **server** key from `AUTTER_RUNTIME_KEY` (the
  same `autter_rt_…` key the backend uses). Never a publishable `autter_rtc_…`
  key; the CLI refuses one.
- The key belongs only where the build or CI step runs: a CI secret, or the
  hosting platform's build environment variable. The user sets it; you only
  reference it by name. Never give it a client-exposed name (`VITE_…`,
  `NEXT_PUBLIC_…`, `REACT_APP_…`, `PUBLIC_…`), never read it from client code,
  and never write it into `.env` files that get committed. In a Docker build,
  pass it as a build secret, not an `ARG`/`ENV` that stays in image layers.
- Without a key, debug ids are still injected and nothing is uploaded, so
  local builds keep working. The maps then stay in the output directory, so
  make sure that build is not the one that gets deployed (see Verify).
- The release defaults to the commit being built: `GITHUB_SHA`,
  `VERCEL_GIT_COMMIT_SHA`, `CF_PAGES_COMMIT_SHA`, `GIT_SHA`, then
  `git rev-parse HEAD`. Releases may contain letters, digits, `.`, `_` and
  `-`. Pass the same commit SHA to `initAutterBrowser({ release })` through
  the build's public env or define mechanism (a commit SHA is not secret).
  Debug ids match maps even when the two differ, but release-based features
  and the pre-1.6.0 fallback need them equal.

## Pick an integration

Install the CLI as a dev dependency with the project's package manager and
commit its lockfile:

```bash
npm install -D @autter/runtime-cli@^1.0.0
```

| Build | Use |
| --- | --- |
| Vite or Rollup, including frameworks that build with Vite | `autterSourceMaps` from `@autter/runtime-cli/vite` (Rollup also `@autter/runtime-cli/rollup`) |
| webpack 5 with an editable config | `AutterSourceMapsWebpackPlugin` from `@autter/runtime-cli/webpack` |
| Next.js | `withAutterSourceMaps` from `@autter/runtime-cli/next` |
| Anything else (CRA, Angular CLI, Parcel, esbuild scripts), or a CI step | `autter-runtime sourcemaps inject` + `upload` |
| GitHub Actions, no bundler plugin | the `upload-sourcemaps` composite action |

Use one integration per build. Do not add the action or a CLI upload on top
of a bundler plugin that already uploads.

### Vite / Rollup

```ts
// vite.config.ts (or wherever the framework exposes Vite plugins)
import { autterSourceMaps } from "@autter/runtime-cli/vite";

export default defineConfig({
  plugins: [/* existing plugins */, autterSourceMaps()],
});
```

When maps are not configured, the plugin sets `build.sourcemap: "hidden"`
(maps are written, bundles do not reference them), injects debug ids after
the bundle is written, uploads under Vite's `base`, and deletes the maps it
created. SSR builds and Vite 6 server environments are skipped. Plain Rollup:
the same import sets `output.sourcemap: "hidden"` when unset.

### webpack

```js
// webpack.config.js: add to the existing plugins list
const { AutterSourceMapsWebpackPlugin } = require("@autter/runtime-cli/webpack");

module.exports = {
  // existing config
  plugins: [/* existing plugins */, new AutterSourceMapsWebpackPlugin()],
};
```

Production builds without a `devtool` get `hidden-source-map`; development
builds are left alone. Assets upload under `output.publicPath` (`/` when it
is `"auto"`).

### Next.js

```js
// next.config.mjs: wrap the final exported config
import { withAutterSourceMaps } from "@autter/runtime-cli/next";

export default withAutterSourceMaps({
  // existing config, including serverExternalPackages from otel-node-style
});
```

Client production builds get hidden maps, uploaded as
`<basePath or assetPrefix>/_next/static/…`. On Next.js 15.4.1+ it runs after
the production compile, so webpack and Turbopack builds are both covered.
Older versions use the webpack plugin, so a Turbopack production build on an
older Next is not covered; report that. Server bundles are never touched.
The wrapper accepts a config object or function. If other wrappers already
exist, keep them and put `withAutterSourceMaps` outermost so it chains their
`webpack` function and `compiler.runAfterProductionCompile` hook.

### Plugin options

All optional: `release`, `urlPrefix`, `endpoint`, `key`, `upload: false`
(inject only, upload later with the CLI or action), `deleteAfterUpload`,
`dryRun`, `concurrency`, `failOnError`, `silent`. `failOnError` defaults to
`false`: a failed upload is logged and never fails the build. Keep that
default. Set `urlPrefix` when the app is served from a subpath or CDN the
bundler's public path does not describe.

### Hidden maps, and projects that already emit maps

The plugins hide and delete only maps they turned on themselves. If the
project already emits maps:

- **Public maps** (`build.sourcemap: true`, a `devtool` such as
  `"source-map"`, `productionBrowserSourceMaps: true`, CRA's default): the
  source is downloadable from production. Point this out. Switch to hidden
  maps (`"hidden"`, `"hidden-source-map"`, or removing
  `productionBrowserSourceMaps`) only with the user's go-ahead; some teams
  publish maps on purpose.
- **Already hidden** maps the project set itself: add
  `deleteAfterUpload: true` so the `.map` files are not deployed.
- **Inline** maps (`"inline"`) leave no files to upload; the Vite plugin warns.
  Switch to `"hidden"`.

### CLI (anything else, or a CI step)

Run it after the build and before deploy, on the exact files you deploy:

```bash
npx autter-runtime sourcemaps inject build
npx autter-runtime sourcemaps upload build --url-prefix / --delete-after-upload
```

- Turn on the builder's own source map output first (hidden if it supports
  it). CRA writes maps by default.
- `--url-prefix` is where the directory is served from: `/` (default),
  `/static/`, `https://cdn.example.com/app/`. Match the app's public path.
- `--delete-after-upload` deletes each `.map` and its `sourceMappingURL`
  comment once the ingester has it, so maps are never deployed.
- `--release` overrides the default; `--dry-run` writes and sends nothing;
  `--json` prints a machine-readable summary.
- `inject` is idempotent and needs no key. `upload` exits `2` with no key, no
  release or a rejected key, `1` when some maps failed, `64` on a usage error.
  Do not chain `upload` into the default `build` script or a `postbuild`
  hook, where it would fail local builds. Put it in the deploy pipeline. If
  that pipeline also runs without the secret (preview deploys, fork PRs),
  guard on the key and still remove the maps:

  ```bash
  npx autter-runtime sourcemaps inject build
  if [ -n "$AUTTER_RUNTIME_KEY" ]; then
    npx autter-runtime sourcemaps upload build --url-prefix / --delete-after-upload
  fi
  ```

`@autter/runtime-node` installs an `autter-runtime` bin too (for `doctor`).
Each hands the other's commands over, so both commands work whichever one
npm linked.

### GitHub Actions

Add a step to the existing job that builds the deployed output, after the
build and before the deploy:

```yaml
- run: npm run build
- uses: Autter-dev/autter-runtime/.github/actions/upload-sourcemaps@main
  with:
    directory: dist
    key: ${{ secrets.AUTTER_RUNTIME_KEY }}
    url-prefix: /
    delete-after-upload: "true"
- run: ./deploy.sh dist
```

Inputs: `directory`, `key` (required), `release` (default `GITHUB_SHA`),
`url-prefix`, `endpoint`, `inject` (`"false"` when a bundler plugin already
injected, for example with `upload: false`), `delete-after-upload`,
`cli-version`. Follow the repository's action pinning convention; if it pins
third-party actions to a tag or commit SHA, pin this one the same way.

## Respect the existing CI

- Wire uploads into the job that already builds and deploys the frontend. Do
  not add a new workflow, a second build, or another CI provider.
- Hosting platforms that build the app (Vercel, Netlify, Cloudflare Pages):
  use the bundler plugin and ask the user to add `AUTTER_RUNTIME_KEY` to the
  platform's build environment as a secret.
- GitHub Actions: pass the secret only to the deploy job's build step (for
  example `env: AUTTER_RUNTIME_KEY: ${{ secrets.AUTTER_RUNTIME_KEY }}`), not
  to jobs that run untrusted pull request code. Fork PRs get no secrets; the
  plugins then skip the upload and the build still passes.
- Injection changes bundle bytes after the build. If the build computes
  subresource integrity hashes (Next.js `experimental.sri`, webpack SRI
  plugins), recompute them after injecting or leave SRI off for these
  bundles. Tell the user rather than silently disabling SRI.
- Inject after any later minify or copy step, so the deployed bytes are the
  injected ones.
- Never ask the user to paste the key into chat, and never print it in CI
  logs.

## Verify

Do the stack check only in an isolated build (a local production build or a
preview environment), never with synthetic errors in production.

1. **Preflight the check endpoint** with the server key and an empty request,
   which stores nothing:

   ```bash
   curl -s -X POST https://otlp.autter.dev/v1/sourcemaps/check \
     -H "Authorization: Bearer $AUTTER_RUNTIME_KEY" \
     -H "Content-Type: application/json" -d '{"release":"preflight","files":[]}'
   # → 200 {"present":[]}. 401 key missing/invalid, 403 client key, 404 ingester older than 1.6.0
   ```

2. **Upload a build.** Run a production build with the key set. Expect
   `[autter-runtime] debug ids: N bundle(s) injected` and a summary line
   `N uploaded, 0 already uploaded, 0 failed (release <sha> from <source>,
   <endpoint>)`. A warning that the ingester predates 1.6.0 means no debug
   ids are stored.
3. **Confirm the ingester has them.** Rebuild the same commit, or re-run
   `npx autter-runtime sourcemaps upload <dir> --json` before maps are
   deleted. Unchanged maps now report as `already uploaded` (`skipped` in
   JSON): that answer comes from `/v1/sourcemaps/check`, so the maps are
   stored for this key's repository. A Next.js rebuild may change some chunks;
   only unchanged ones are skipped.
4. **Confirm nothing public is deployed.** In the output that gets deployed,
   `find dist -name '*.map'` is empty (unless the project serves maps on
   purpose), bundles carry a `//# debugId=` comment, and no bundle has a
   `sourceMappingURL` pointing at a map you meant to hide.
5. **Throw a test error in the isolated build.** Serve the production build
   locally (`vite preview`, `next start`, a static server) with
   `environment` set to a non-production value, and trigger the temporary
   selftest exception from the style skill. In the browser's network tab,
   the exception event in the POST body carries `debugIds` for the script in
   its stack.
6. **Check the stored stack.** The issue's stack in the Autter dashboard
   shows original file paths (for example `src/checkout/Cart.tsx`) and
   function names, not `index-4f3c.js`. Self-hosted:
   `SELECT frames FROM autter_runtime.runtime_error_occurrences ORDER BY occurred_at DESC LIMIT 1`
   shows frames with `"resolved":true` and original `filename` values.
7. Remove the temporary selftest error.

Troubleshooting:

- **Frames stay minified.** The deployed files were not the injected ones
  (inject after the last minify/copy step), the browser SDK or ingester is
  older than 1.6.0, or a relay older than 1.6.0 dropped `debugIds`. Without
  debug ids, the SDK `release` must equal the upload release and the URL
  prefix must match the served path.
- **`map is … MB … the ingester accepts up to 5 MB`.** Split the bundle so
  each map stays under 5 MB without `sourcesContent`.
- **`release "…" is not valid`.** Use a commit SHA or letters, digits, `.`,
  `_` and `-` only.

Reference: [Readable stack traces](https://github.com/Autter-dev/autter-runtime/blob/main/docs/SOURCE-MAPS.md).
