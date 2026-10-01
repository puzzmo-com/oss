# @puzzmo-com/codegen

Native front end for the API codegen pipeline. The Rust lives in [`crates/puzzmo-codegen`](../../crates/puzzmo-codegen); this package is the thin JS wrapper that finds the right prebuilt binary.

**You do not need Rust to work in this repo.** The binary arrives through `yarn install` as a per-platform npm package, the same way `oxlint`, `oxfmt` and `relay-compiler` already do. Nothing in `yarn build`, `yarn test` or `yarn type-check` compiles it.

## What it does today

One command, `gate`, which answers "does `yarn workspace api script regenerate` have anything to do?" in about 10ms, without booting Node:

```
puzzmo-codegen gate [--quiet]
```

| Exit | Meaning                                                  |
| ---- | -------------------------------------------------------- |
| 0    | Every codegen artifact is up to date                     |
| 1    | Something is stale (the steps are listed on stderr)      |
| 2    | The gate itself failed — do **not** read this as "clean" |
| 3    | No binary for this platform (from the JS launcher only)  |

`.husky/post-merge` uses this to regenerate automatically after a pull. The slow path is the same `regenerate` script as before, so a missing binary costs speed, never correctness.

## How the steps are defined

[`regenerate.manifest.json`](../../apps/api.puzzmo.com/scripts/lib/regenerate.manifest.json) lists each step's inputs and outputs. Both the gate and `scripts/lib/regenCache.ts` read it, so the two cannot disagree about what a step depends on.

**Adding or changing a codegen step means editing the manifest**, not just the TypeScript. The hashing in [`hash.rs`](../../crates/puzzmo-codegen/src/hash.rs) and `regenCache.ts` must stay byte-compatible — they hash each file's repo-relative path followed by its contents, over a sorted list.

That byte-compatibility is **transitional scaffolding, not a permanent rule**. The plan is for the steps to move into the crate one at a time until the TypeScript pipeline is deleted; at that point `regenCache.ts` goes with it, the manifest has a single reader, and the constraint disappears. Don't design around keeping the two hashers in step forever — design around deleting one of them.

The gate treats a missing input as "stale" rather than an error, because `api-schema.graphql` is one step's output and another's input. That means a typo in the manifest degrades into "regenerate runs every time" instead of a crash, so the tests in `crates/puzzmo-codegen/tests/manifest.rs` are what actually catch typos. They run in CI.

Note what changes when the TypeScript goes: today a missing binary costs speed, because every caller has a slower JS route. Once that route is gone, a missing binary means codegen cannot run at all, and the five published targets become a hard floor rather than an optimisation. They cover every environment in use today (all the repo's images are glibc — `node:26-bookworm-slim`, playwright `noble`); musl/Alpine is the one uncovered case, and nothing here uses it.

## Working on the Rust

```bash
yarn workspace @puzzmo-com/codegen build:native   # cargo build --release
yarn workspace @puzzmo-com/codegen test:native    # cargo test --release
```

`resolve.js` prefers `crates/target/release/puzzmo-codegen` when it exists, so a local build takes effect immediately without publishing.

## Releasing

The binaries are built and published **from `puzzmo-com/oss`**, not from here:

```text
monorepo (private)                    puzzmo-com/oss (public)              npm
  crates/puzzmo-codegen  --OSS-Sync-->  crates/puzzmo-codegen
  packages/codegen       --OSS-Sync-->  packages/codegen
                                        .github/workflows/   --publish-->  @puzzmo/codegen-<platform>
                                          publish-codegen.yml
```

[`OSS-Sync.yml`](../../.github/workflows/OSS-Sync.yml) mirrors the crate and this package on every push that touches them. The OSS repo's `publish-codegen.yml` then builds five targets and publishes them together at one shared version (the highest already on npm, patch-incremented).

That workflow is **hand-maintained in the OSS repo**. A copy lives at [`oss-publish-codegen.yml`](../../crates/puzzmo-codegen/oss-publish-codegen.yml) so it sits beside the crate, but the sync deliberately does not write to `.github/` — pushing workflow files needs a token with the `workflow` scope, and risking the whole sync for that is not worth it. Copy it over once; it only changes when the build matrix does.

In this repo, [`Codegen-Crate-Check.yml`](../../.github/workflows/Codegen-Crate-Check.yml) only runs `cargo test`. Those tests assert things about the monorepo (every manifest input exists, every generated artifact is committed), so they skip themselves when the crate is built in the OSS mirror, where none of those files exist.

Changing the binary's behaviour is a two-step loop: merge the Rust, wait for the sync and publish, then bump the `optionalDependencies` versions here. That is the main cost of this setup, and it is why the generator should stay small and stable while the schemas it reads change freely.

Supported platforms are `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win32-x64`. The list appears in both `resolve.js` and `scripts/publishPlatformPackages.mjs` and has to match in both.

**Adding a platform takes one manual step.** Trusted publishing attaches a publisher to a package that already exists, so a brand new `@puzzmo/codegen-<platform>` cannot be published from CI until someone has published it once by hand — a `package.json` with the right `name`, `os` and `cpu` is enough — and enabled trusted publishing on it. The five current platforms are already through that. `publishPlatformPackages.mjs` fails with this instruction rather than letting npm return a permissions error that looks like a broken token.

## Why public npm, and why two scopes

The platform packages go to **public npm under `@puzzmo`** — the scope `@puzzmo/sdk`, `@puzzmo/cli` and `create-puzzmo` already ship from — while this wrapper stays `@puzzmo-com/*` like every other internal workspace.

That split is deliberate. `@puzzmo-com/*` lives on GitHub Packages, which requires authentication on _every_ read, even for public packages. A binary published there could not be installed on a fresh clone unless each contributor first configured a GitHub PAT, which defeats the point of shipping prebuilt binaries. Public npm needs no auth, so `yarn install` just works.

Publishing from the public OSS repo also means no npm credential is needed anywhere: that repo uses npm trusted publishing (OIDC), which is why `npm publish --provenance` works there with no token at all. Provenance additionally wants a public source repo, so this would not work cleanly from the monorepo even with a token.

Nothing sensitive leaves the repo: the binary reads [`regenerate.manifest.json`](../../apps/api.puzzmo.com/scripts/lib/regenerate.manifest.json) and your sources at runtime and embeds neither. The next thing to move into it, sdl-codegen, is already open source through the same sync.

No `.yarnrc.yml` change is needed: with no `npmScopes` configured, `@puzzmo/*` resolves to the default public registry already.
