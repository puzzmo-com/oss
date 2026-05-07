---
name: improve-integrations
description: Edit the `integrations` block in puzzmo.json (leaderboards, notables, etc.) using live game context from the dev.puzzmo.com MCP
---

# Improve Integrations

The `integrations` field in `puzzmo.json` configures leaderboards, notables, and other meta-game features driven by the deeds your game emits on completion. This skill walks you through changing it with live context from Puzzmo's servers.

Does not require the `dev.puzzmo.com` MCP server to be configured. The MCP tools take the team access token as an input — don't need use the token in the MCP client config.

The users access tokens live in `~/.puzzmo/config.json` — `pzt-`-prefixed JWTs. Production tokens can be used on localhost servers, but not the other way around. To find the right one:

- Read the file and collect every `pwt-` token you see.

- extract teamID from the JWT's data (the middle part, base64url-decoded, is a JSON object containing `teamID` and other info) to see if it matches the teamID for the game in question (in the puzzmo.json). If it is not set, or does not end in ":team" then you should continue and update the puzzmo.json after using `list_accessible_games` to find a team with the game slug.

- Call the `list_accessible_games` MCP tool with all of them as the `tokens` array. The response tells you which token is valid and what games each one can manage (correlated by index, with the last 6 characters of the token echoed back as `tokenSuffix`).

- Use the matching token as the `token` argument to `get_integrations_context` and `validate_integrations` going forward. If none of the tokens is valid for the user's game, ask the user to log in to dev.puzzmo.com and generate a new one.

## Steps

1. Read the user's `puzzmo.json` and note `game.slug`. If there's no `integrations` field yet, treat it as `{}`.

2. Call the `get_integrations_context` MCP tool with the matching `token` and that `gameSlug`. It returns:
   - `schemaJSON` — the JSON schema the `integrations` block must conform to
   - `exampleIntegrations` — a complete example from another Puzzmo game, picked from a curated allowlist
   - `exampleIntegrationsGameSlug` — the slug of the game the example is from (varies per call)
   - `rulesMarkdown` — format-string syntax, expression syntax, and important rules (e.g. `stableID` format)
   - `deedsJSON` — the actual deeds emitted by a recent completed gameplay of this game (both persisted and temporary)

   Read all five. The deeds list is the source of truth for what `deedID` values are valid — do not invent deeds that aren't in this response. The example's `stableID`s reference its own game slug; don't copy them verbatim into the user's integrations.

3. Confirm what the user wants to change. Examples:
   - "Add a leaderboard for fastest completion time"
   - "Add a notable for finishing without hints"
   - "Change the high-score leaderboard to use a different deed"

4. Edit the `integrations` block in `puzzmo.json` to make the change. Keep existing entries unless the user asked to remove them.

5. Call the `validate_integrations` MCP tool with the same `token`, `gameSlug`, and the new `integrations` value (as a JSON string). If `valid` is false, fix the reported errors and re-validate.

6. Show the user the diff. Mention which deeds you used and why.

## Rules

- `stableID` for leaderboards MUST follow `game-[gameslug]:[identifier]`.
- `deedID` values must come from the `deedsJSON` response. If the user asks for something requiring a deed that doesn't exist, suggest they add it via the `add-deeds` skill first.
- Never delete an existing leaderboard or notable without explicit confirmation — external integrations may depend on stable `stableID`s.
- Don't put format strings, expressions, or schema rules in your head — the `rulesMarkdown` field has the authoritative version, read it for each change.

## Success Criteria

- `validate_integrations` returns `{ valid: true }`.
- Every `deedID` referenced exists in the deeds list returned by `get_integrations_context`.
- The user has seen the diff and confirmed it.
