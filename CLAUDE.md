# puzzmo-com/oss

This repo exists to publish Puzzmo's open-source npm packages. It is not the source of truth for code.

## How it works

1. Source code lives in the `puzzmo-com/app` monorepo (Yarn 4 workspaces) (usually in `../app` or `../app-2`)
2. The `OSS-Sync.yml` workflow in `app` uses rsync to copy `packages/*` and `skills/` into this repo on every push to main
3. The `publish.yml` workflow here builds and publishes changed packages to npm using OIDC trusted publishing (no npm token needed)

## Packages are read-only

Everything under `packages/` is synced from `app` and will be overwritten on the next sync. Do not edit package source code here — make changes in `app` instead.

Files that live only in this repo and are safe to edit:

- `CLAUDE.md`, `README.md`, `.gitignore`
- `.github/workflows/publish.yml`
- `.yarnrc.yml`, `package.json` (root workspace config)
- `yarn.lock`

## Package overview

| Package                     | npm name                   | Published    |
| --------------------------- | -------------------------- | ------------ |
| `packages/sdk`              | `@puzzmo/sdk`              | Yes          |
| `packages/cli`              | `@puzzmo/cli`              | Yes          |
| `packages/agent-cli-detect` | `@puzzmo/agent-cli-detect` | Yes          |
| `packages/create-puzzmo`    | `create-puzzmo`            | Yes          |
| `packages/obebel`           | `@puzzmo-com/obebel`       | Yes          |
| `packages/belay`            | `@puzzmo-com/belay`        | No (private) |
| `packages/sdl-codegen`      | `@sdl-codegen/node`        | No (private) |

## Publishing

- **On push to main**: only packages with file changes in the last commit are published
- **On workflow_dispatch**: all non-private packages are published
- Versions are auto-incremented (patch bump from the current npm version)
- `devDependencies` and `workspace:`/`catalog:` refs are stripped before publish
- Authentication uses npm OIDC trusted publishing (requires `id-token: write` permission)
- Each package must have OIDC configured on npmjs.com (Settings → Trusted Publishing → `puzzmo-com/oss` / `publish.yml`)

## Build setup

The root `package.json` and `.yarnrc.yml` configure a Yarn 4 workspace with:

- A catalog for shared dependency versions (typescript, vite, vitest)
- Resolutions for `@typescript/native-preview` and `@babel/types` to avoid version conflicts
