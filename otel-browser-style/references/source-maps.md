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

## Four steps

Run them for each frontend, in the app's directory (the one with its
`package.json`):

1. **Check** what is published and deployed.
2. **Set up** the build with `autter-runtime sourcemaps setup`.
3. **Key:** put an upload-only key in CI without writing it anywhere else.
4. **Verify** a production build with `autter-runtime sourcemaps verify`.

`setup` and `verify` need `@autter/runtime-cli` **1.2.0+**. With an older
CLI, do step 1, follow [Manual setup](#manual-setup-cli-older-than-120)
instead of step 2, then step 3, and
[check the build by hand](#check-a-build-by-hand-cli-older-than-120).

### 1. Check

**With Autter MCP connected** (`https://api.autter.dev/mcp`; connect and
match the repository with `whoami` as `autter-repo-context` describes), call
`get_runtime_setup`:

```json
{"repo":"owner/repo"}
```

It is read-only (`mcp:read`) and never returns a key. Read:

- `ingester.version` and `features` (`id`, `available`):
  `source_map_debug_ids` (ingester 1.6.0), `sourcemap_upload_keys` and
  `source_map_verify` (ingester 1.7.0).
- `sourcemap_upload_keys`: `available`, and `reason` when it is not.
- `keys`: per kind (`server`, `client`, `upload`), the `active` count,
  `key_prefixes` (display prefixes such as `autter_rtu_ab12…`) and
  `last_used_at`.
- `source_maps`: `uploaded` and `last_uploaded_at` (maps are kept 30 days).
- `sdks`: the SDK version each service reports.
- `settings_url`: the repository's Runtime settings page, at its "Source map
  upload key" section.
- `next_steps`.

**Without MCP**, ask the ingester (public, no key):

```bash
curl -s "https://otlp.autter.dev/v1/compat?features=source_map_debug_ids,sourcemap_upload_keys,source_map_verify"
# → "available": true/false per feature; a 404 means an ingester older than 1.5.0
```

`get_runtime_setup` always describes the hosted endpoint
(`ingest_endpoint_source: "default"`). For a self-hosted ingester, run the
curl against the URL the user gave as well; it needs migration
`0017-source-maps-debug-id`.

**Either way**, check the published CLI:

```bash
npm view @autter/runtime-cli version
```

- **1.2.0 or later:** steps 2 to 4.
- **Older:** `setup`, `verify` and `upload --best-effort` do not exist yet.
  Follow [Manual setup](#manual-setup-cli-older-than-120) and report that
  `setup` and `verify` are pending the CLI 1.2.0 release.
- **`E404`:** not published. Wire nothing from this file: no devDependency,
  no plugin import, no CI step and no `upload-sourcemaps` action (it runs
  `npx` on the package and would fail). Keep any source-map upload the repo
  already has. Report **source maps as pending the `@autter/runtime-cli`
  release** and tell the user how to add them later: re-run this setup once
  the command prints a version.

Also check:

- **Browser SDK:** debug ids need `@autter/runtime-browser` (or
  `@autter/runtime-next`) **1.6.0+** installed. Check the installed package,
  not the range (`setup` reports it in `detected.sdk`). With an older SDK,
  maps match by release and path only, so the SDK `release` must equal the
  upload release and the URL prefix must match the served path.
- **Relay:** a Node relay (`createBrowserRelayHandler`,
  `createAutterRelayRoute`) must run `@autter/runtime-node` **1.6.0+**, or it
  drops the `debugIds` the browser sends.
- **Ingester:** before 1.6.0, `.js` maps still upload and match by release
  and path; the CLI warns and uploads everything. Before 1.7.0 there are no
  upload-only keys (use the server key), and `verify` reports the upload as
  unverified.

### 2. Set up

From a clean working tree, so the diff shows only what setup changed:

```bash
npx @autter/runtime-cli@^1.2.0 sourcemaps setup --json
```

It is non-interactive and safe to re-run; `--dry-run` reports the same plan
and writes nothing. Exit `0`: everything was applied. `2`: `manual` actions
remain. `1`: an error, such as no `package.json`. The JSON holds `detected`
(build tool, package manager, `ci`, `outputDir`, `urlPrefix`, `sourceMaps`,
`sdk`, `release`), `actions` (each `{ type, file?, description, snippet?,
command? }`, `type` one of `edit`, `add-dependency`, `add-script`, `manual`,
`set-secret`), `secret` (`name`, and `where`: per CI, a `note` and, where one
exists, a `command` that reads the key from a prompt or stdin), `next` and
`exitCode`.

What setup does by itself:

- adds `@autter/runtime-cli` to `devDependencies`;
- adds `autterSourceMaps()` (Vite and the frameworks built on it, Rollup) or
  `new AutterSourceMapsWebpackPlugin()` (webpack, Vue CLI), or wraps the
  Next.js config in `withAutterSourceMaps(...)` outermost, when it can parse
  the config and edit it safely; it splices in only the import and the plugin;
- gives builds without a plugin (Create React App, Angular CLI, Parcel,
  esbuild) a `postbuild` script, appended to `build` for pnpm, Yarn 2+ and
  Bun, which skip `postbuild`:

  ```bash
  autter-runtime sourcemaps inject build && autter-runtime sourcemaps upload build --delete-after-upload --best-effort
  ```

  `--best-effort` exits `0` without a key or after a failed upload, and with
  `--delete-after-upload` it deletes every `.map` in the output either way,
  so local builds and fork PRs pass and never ship maps;
- turns on hidden maps where the tool supports them
  (`GENERATE_SOURCEMAP=true`, Angular `"sourceMap": { "scripts": true,
  "hidden": true }`).

It never edits app code and never writes a key. Then:

1. **Review the diff** (`git diff`). Expect only the devDependency, the
   plugin import and call (or the wrapper), a `postbuild` or `build` script,
   and hidden-map settings. Existing plugins and wrappers stay as they were.
   Undo any other change and make it by hand.
2. **Install** with the project's package manager: run the `add-dependency`
   action's `command`, or re-run setup with `--install`. Commit the lockfile.
3. **Carry out every `manual` action.** Each has a `description`, usually a
   `file`, and the exact `snippet`. The common ones:
   - **Release:** `initAutterBrowser` gets no `release`. Pass the commit SHA
     through the build tool's public env or define mechanism as the snippet
     shows; a commit SHA is not secret. Only the release takes a public
     prefix, never the key.
   - **CI env wiring:** pass the secret to the GitHub Actions step that runs
     the production build, in that job only and never in jobs that run
     untrusted pull request code:
     `env: AUTTER_RUNTIME_KEY: ${{ secrets.AUTTER_RUNTIME_KEY }}`.
   - A config setup could not edit safely, inline maps, a browser SDK older
     than 1.6.0, or an unrecognised build tool.
4. **Read `next`.** It flags public maps (decide with the user, see
   [Projects that already emit maps](#projects-that-already-emit-maps)), a
   Turbopack build on Next.js older than 15.4.1, a missing browser SDK, and
   the verify command.
5. Leave the `set-secret` actions and `secret.where` for step 3.
6. **Re-run setup.** It lists only what is left. Exit `0` means nothing is.
   A `manual` action it cannot detect may stay after you did it by hand;
   name it in the hand-off.

Never write a key into any file: not a `.env` file, the bundler config, a
plugin's `key` option, a workflow or a script.

### 3. Key

The build that produces the deployed output reads `AUTTER_RUNTIME_KEY`.
Prefer an **upload-only key** (`autter_rtu_…`, ingester 1.7.0+): it can only
upload and check source maps, so a leaked CI secret cannot send telemetry.
The server key (`autter_rt_…`) also works. A publishable client key
(`autter_rtc_…`) is refused.

**First check whether that build already has a key.** It has one when the
workflow passes `secrets.AUTTER_RUNTIME_KEY` and the secret exists
(`gh secret list --repo owner/repo` shows names, never values), when the
hosting platform's build environment sets it (ask the user), or when
`get_runtime_setup` shows an upload key in `keys.upload` used recently or a
recent `source_maps.last_uploaded_at`. Then create nothing. An existing
`AUTTER_RUNTIME_KEY` is often the server key a backend or a Next.js relay
reads at run time: keep it, it uploads maps too. Never replace it with an
upload key, or the backend or relay gets `403 upload_key_not_allowed`.

**When there is none, with MCP.** Use this path when the user has a
non-viewer role, the production build runs on a platform `set_secret` covers
(GitHub Actions, GitLab CI, Vercel or Netlify), and you can run its command
there (the platform's CLI is installed and signed in to that repository or
project):

1. Call `create_sourcemap_upload_key` (`mcp:write`):

   ```json
   {"repo":"owner/repo","name":"Source maps (CI)"}
   ```

   It returns the key once (`key`, `key_prefix`, `scope: "upload"`,
   `env_var`), `set_secret` (per `target`: `github_actions`, `gitlab_ci`,
   `vercel_production`, `vercel_preview`, `netlify`; each a `command` that
   reads the key from stdin, and a `pipe_example`), `safety` and
   `revoke_url`.
2. **Immediately** store it with the matching entry's `pipe_example`, in a
   single command where the variable holds the key for that command only:

   ```bash
   ( AUTTER_RUNTIME_KEY='<key>'; printf '%s' "$AUTTER_RUNTIME_KEY" | gh secret set AUTTER_RUNTIME_KEY --repo owner/repo )
   ```

   Do not run it with shell tracing (`set -x`), which would print the key.
3. From then on, name the key by its `key_prefix` only. Never print it back,
   never write it to a file (no `.env`, no temporary file), never put it in
   a commit, a PR body, a log or the hand-off, and do not set it in your own
   shell for a local build.
4. If the command fails, do not retry in any way that shows the key. Give
   the user its prefix, ask them to revoke it at `revoke_url`, and take the
   path below.

Refusals: `insufficient_role` (a viewer) and `insufficient_scope` (no
`mcp:write`) mean the path below. `sourcemap_upload_keys_unavailable` means
the live ingester is older than 1.7.0: `detail.alternative` points at a
server key, so take the path below with a server key.

**Otherwise, the user creates it.** Without MCP, without the role, or for a
platform you cannot set (Cloudflare Pages dashboard variables, a CI without
a signed-in CLI), tell the user:

> Create a source map upload key in Autter: **Repository → Settings →
> Runtime → Source map upload key → Create upload key** (`settings_url`).
> Then store it as `AUTTER_RUNTIME_KEY` where the production build runs,
> yourself; I don't need to see it.

Give them the matching `secret.where` entry from setup: its `command` (for
example `gh secret set AUTTER_RUNTIME_KEY --repo owner/repo`, which prompts
for the value) or its `note`. For Cloudflare Pages: Cloudflare dashboard →
Workers & Pages → the project → Settings → Variables and Secrets → Add, type
**Secret**, name `AUTTER_RUNTIME_KEY`, for Production (and Preview if
preview builds should upload). For a server key, the user creates it under
**Settings → Access Tokens → Runtime ingest keys** instead. Never ask for the
key in chat.

### 4. Verify

Run a production build in an isolated environment (a local production
build or a preview), never with synthetic errors in production. Then:

```bash
npx autter-runtime sourcemaps verify <outputDir> --json
```

`<outputDir>` is setup's `detected.outputDir` (`dist`, `build`,
`.next/static`, …). `npx autter-runtime` runs the bin installed in step 2;
without it, `npx @autter/runtime-cli@^1.2.0 sourcemaps verify` does the same.
It must pass, exit `0` with `ok: true`:

- every entry in `bundles` has `status: "ok"` and a `debugId`, or
  `"skipped"` with a reason for files that are not bundles (copied from
  `public/`, Next.js manifests, service workers);
- `maps` is empty: no `.map` file is left to deploy, and no
  `sourceMappingURL` points at a missing or inline map;
- `upload.status` is `verified`: the ingester has every bundle's map for
  this key's repository (needs a key and ingester 1.7.0+).

Each problem is in `failures` (`path`, `reason`). `--ignore <glob>` skips JS
files in the output that are not bundles; `--url-prefix` and `--endpoint`
match the upload. Do not pass `--allow-maps` for the deployed output: it is
for a step that runs before maps are removed.

**Without a key locally**, `upload.status` is `unverified` and its `reason`
says the key is not set. That is acceptable for a local run: report that the
CI build verifies the upload. Postbuild integrations inject without a key,
so their local verify passes as `unverified`. The bundler plugins turn no
maps on and inject nothing without a key (they print `AUTTER_RUNTIME_KEY is
not set: no source maps generated, nothing uploaded`), so a local plugin
build fails with `no debug id` for every bundle: the plugin was idle, which
is expected. If the user's own environment has a key, build with it and
expect `verified`.

Where it fits, make CI the check. In the GitHub Actions job that builds the
deployed output with the secret, add `verify` after the build and before the
deploy. Not in pull request jobs: without the secret, plugin builds have no
debug ids and verify fails.

```yaml
- run: npm run build
  env:
    AUTTER_RUNTIME_KEY: ${{ secrets.AUTTER_RUNTIME_KEY }}
- run: npx autter-runtime sourcemaps verify dist
  env:
    AUTTER_RUNTIME_KEY: ${{ secrets.AUTTER_RUNTIME_KEY }}
- run: ./deploy.sh dist
```

Where the upload runs through the `upload-sourcemaps` action, set
`verify: "true"` (the default): it runs `verify` after the upload. On a
hosting platform that builds the app (Vercel, Netlify, Cloudflare Pages),
check the first deploy's build log for the upload line instead, or verify a
preview build that had the key.

Then check one symbolicated stack (see
[Check a symbolicated stack](#check-a-symbolicated-stack)).

## Keys and release

- Every integration reads the key from `AUTTER_RUNTIME_KEY`, only where the
  build or CI step runs: a CI secret, or the hosting platform's build
  environment variable. Never give it a client-exposed name (`VITE_…`,
  `NEXT_PUBLIC_…`, `REACT_APP_…`, `PUBLIC_…`), never read it from client
  code, and never write it into `.env` files that get committed. In a Docker
  build, pass it as a build secret, not an `ARG`/`ENV` that stays in image
  layers.
- An upload-only key works only on `/v1/sourcemaps` and
  `/v1/sourcemaps/check`; every other route answers `403
  upload_key_not_allowed`. Backends and browser relays keep the server key.
- Without a key, the bundler plugins turn no source maps on and inject no
  debug ids, so the build is exactly what it was, and `upload --best-effort`
  uploads nothing and exits `0`. Local builds and fork PRs keep working.
- The release defaults to the commit being built: `GITHUB_SHA`,
  `VERCEL_GIT_COMMIT_SHA`, `CF_PAGES_COMMIT_SHA`, `GIT_SHA`, then
  `git rev-parse HEAD`. Releases may contain letters, digits, `.`, `_` and
  `-`. Pass the same commit SHA to `initAutterBrowser({ release })` through
  the build's public env or define mechanism. Debug ids match maps even when
  the two differ, but release-based features and the pre-1.6.0 fallback need
  them equal.

## Integrations and manual setup

`setup` wires the integrations below; this is what it changed, and how to
wire them by hand.

### Manual setup (CLI older than 1.2.0)

Use this when the newest published `@autter/runtime-cli` is older than
1.2.0, or to finish a `manual` action by hand. Install the newest published
version as a dev dependency with the project's package manager, and commit
its lockfile. Use 1.1.0 or later: 1.0.0's bundler plugins could leave source
maps in the deployed output.

```bash
npm install -D @autter/runtime-cli@^1.1.0
```

| Build | Use |
| --- | --- |
| Vite or Rollup, including frameworks that build with Vite | `autterSourceMaps` from `@autter/runtime-cli/vite` (Rollup also `@autter/runtime-cli/rollup`) |
| webpack 5 with an editable config | `AutterSourceMapsWebpackPlugin` from `@autter/runtime-cli/webpack` |
| Next.js | `withAutterSourceMaps` from `@autter/runtime-cli/next` |
| Anything else (CRA, Angular CLI, Parcel, esbuild scripts), or a CI step | `autter-runtime sourcemaps inject` + `upload` |
| GitHub Actions, no bundler plugin | the `upload-sourcemaps` composite action |

Use one integration per build. Do not add the action or a CLI upload on top
of a bundler plugin that already uploads. Keys follow step 3.

### Vite / Rollup

```ts
// vite.config.ts (or wherever the framework exposes Vite plugins)
import { autterSourceMaps } from "@autter/runtime-cli/vite";

export default defineConfig({
  plugins: [/* existing plugins */, autterSourceMaps()],
});
```

With a key and no maps configured, the plugin sets `build.sourcemap:
"hidden"` (maps are written, bundles do not reference them), injects debug
ids after the bundle is written, uploads under Vite's `base`, and then
deletes every map it generated, whether or not the upload succeeded. SSR
builds get no maps from it. Plain Rollup: the same import sets
`output.sourcemap: "hidden"` when unset.

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
(inject only, upload later with the CLI or action; the generated maps are
then kept, so keep them out of the deploy), `deleteAfterUpload`, `dryRun`,
`concurrency`, `failOnError`, `silent`. `failOnError` defaults to `false`: a
failed upload is logged and never fails the build. Keep that default. Set
`urlPrefix` when the app is served from a subpath or CDN the bundler's public
path does not describe. Never pass `key` a literal value.

### Projects that already emit maps

The plugins delete every map they turned on themselves, uploaded or not.
Maps the project configured itself are never touched unless
`deleteAfterUpload: true`. If the project already emits maps:

- **Public maps** (`build.sourcemap: true`, a `devtool` such as
  `"source-map"`, `productionBrowserSourceMaps: true`, CRA's default): the
  source is downloadable from production. Point this out. Switch to hidden
  maps (`"hidden"`, `"hidden-source-map"`, or removing
  `productionBrowserSourceMaps`) only with the user's go-ahead; some teams
  publish maps on purpose.
- **Already hidden** maps the project set itself: add
  `deleteAfterUpload: true` so the `.map` files are not deployed.
- **Inline** maps (`"inline"`) leave no files to upload. Switch to
  `"hidden"`.

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
- With 1.2.0+, `--best-effort` makes the upload safe in a `postbuild` script
  (what `setup` writes): it always exits `0`, and with
  `--delete-after-upload` it deletes every map anyway. Before 1.2.0, keep
  `upload` out of `build` and `postbuild`, where it would fail local builds.
  Put it in the deploy pipeline, and if that pipeline also runs without the
  secret (preview deploys, fork PRs), guard on the key and still remove the
  maps:

  ```bash
  npx autter-runtime sourcemaps inject build
  if [ -n "$AUTTER_RUNTIME_KEY" ]; then
    npx autter-runtime sourcemaps upload build --url-prefix / --delete-after-upload
  else
    find build -name '*.map' -delete
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

Inputs: `directory`, `key` (required: an upload-only key or the server key),
`release` (default `GITHUB_SHA`), `url-prefix`, `endpoint`, `inject`
(`"false"` when a bundler plugin already injected, for example with
`upload: false`), `delete-after-upload`, `verify` (default `"true"`: runs
`sourcemaps verify` after the upload with runtime-cli 1.2.0+, skipped with a
notice before), `verify-ignore`, `cli-version`. Follow the repository's
action pinning convention; if it pins third-party actions to a tag or commit
SHA, pin this one the same way.

### Check a build by hand (CLI older than 1.2.0)

1. **Preflight the check endpoint** with the key and an empty request, which
   stores nothing:

   ```bash
   curl -s -X POST https://otlp.autter.dev/v1/sourcemaps/check \
     -H "Authorization: Bearer $AUTTER_RUNTIME_KEY" \
     -H "Content-Type: application/json" -d '{"release":"preflight","files":[]}'
   # → 200 {"present":[]}. 401 key missing/invalid (or an upload key on an ingester
   #   older than 1.7.0), 403 client key, 404 ingester older than 1.6.0
   ```

2. **Upload a build.** Run a production build with the key set. Expect
   `[autter-runtime] debug ids: N bundle(s) injected` and a summary line
   `N uploaded, 0 already uploaded, 0 failed (release <sha> from <source>,
   <endpoint>)`.
3. **Confirm the ingester has them.** Re-run
   `npx autter-runtime sourcemaps upload <dir> --json` before maps are
   deleted: unchanged maps report as `already uploaded` (`skipped` in JSON),
   an answer from `/v1/sourcemaps/check`.
4. **Confirm nothing public is deployed.** In the output that gets deployed,
   `find dist -name '*.map'` is empty (unless the project serves maps on
   purpose), bundles carry a `//# debugId=` comment, and no bundle has a
   `sourceMappingURL` pointing at a map you meant to hide.

## Respect the existing CI

- Wire uploads into the job that already builds and deploys the frontend. Do
  not add a new workflow, a second build, or another CI provider.
- Hosting platforms that build the app (Vercel, Netlify, Cloudflare Pages):
  use the bundler plugin or the `postbuild` step setup adds, and store
  `AUTTER_RUNTIME_KEY` in the platform's build environment (step 3).
- GitHub Actions: pass the secret only to the deploy job's build step (for
  example `env: AUTTER_RUNTIME_KEY: ${{ secrets.AUTTER_RUNTIME_KEY }}`), not
  to jobs that run untrusted pull request code. Fork PRs get no secrets; the
  plugins and `--best-effort` then skip the upload, leave no maps, and the
  build still passes.
- Injection changes bundle bytes after the build. If the build computes
  subresource integrity hashes (Next.js `experimental.sri`, webpack SRI
  plugins), recompute them after injecting or leave SRI off for these
  bundles. Tell the user rather than silently disabling SRI.
- Inject after any later minify or copy step, so the deployed bytes are the
  injected ones.
- Never ask the user to paste the key into chat, and never print it in CI
  logs.

## Check a symbolicated stack

In the same isolated build, never in production:

1. Serve the production build locally (`vite preview`, `next start`, a
   static server) with `environment` set to a non-production value, and
   trigger the temporary selftest exception from the style skill. In the
   browser's network tab, the exception event in the POST body carries
   `debugIds` for the script in its stack.
2. The issue's stack in the Autter dashboard shows original file paths (for
   example `src/checkout/Cart.tsx`) and function names, not
   `index-4f3c.js`. Self-hosted:
   `SELECT frames FROM autter_runtime.runtime_error_occurrences ORDER BY occurred_at DESC LIMIT 1`
   shows frames with `"resolved":true` and original `filename` values.
3. Remove the temporary selftest error.

## Troubleshooting

- **Frames stay minified.** The deployed files were not the injected ones
  (inject after the last minify/copy step), the build ran without a key, the
  browser SDK or ingester is older than 1.6.0, or a relay older than 1.6.0
  dropped `debugIds`. Without debug ids, the SDK `release` must equal the
  upload release and the URL prefix must match the served path.
- **`403 upload_key_not_allowed`.** An upload-only key was used for
  telemetry. Backends and relays need the server key.
- **The ingester rejected an upload key (401), "need ingester 1.7.0".** The
  ingester predates upload keys, or the key is wrong. Use the server key
  until the ingester is upgraded.
- **`verify`: `upload: unverified`, "predates 1.7.0".** The ingester cannot
  check maps by debug id; the local checks still ran.
- **Map too large.** Ingester 1.6.1+ takes maps up to 32 MB without
  `sourcesContent`; 1.6.0 and older answer 413 above 5 MB. Upgrade the
  ingester, or split the bundle.
- **Frames named after call sites** (`run`, `fn`, `listener`). The map was
  uploaded without function scopes, by an older CLI or with a warning. Upload
  it again with the current `@autter/runtime-cli`.
- **`release "…" is not valid`.** Use a commit SHA or letters, digits, `.`,
  `_` and `-` only.

Reference: [Readable stack traces](https://github.com/Autter-dev/autter-runtime/blob/main/docs/SOURCE-MAPS.md).
