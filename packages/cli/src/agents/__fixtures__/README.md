# Agent output fixtures

Captured/derived samples of each CLI's headless event stream, used by
`parse-line.test.ts` to lock down the `parseLine` mappers without needing the
CLIs installed. Provenance matters — only `claude` is a first-party capture;
the rest are transcribed from public docs/schemas and should be re-captured
against a real run when someone has that subscription.

| Fixture | Source | Trust |
| --- | --- | --- |
| `claude.jsonl` | Real capture: `claude -p --output-format stream-json --include-partial-messages --verbose` (2026-07-18). IDs/paths trimmed; event shapes verbatim. | High — real |
| `codex.jsonl` | Transcribed from the `codex exec --json` event cheatsheet (takopi.dev) matching `@openai/codex-sdk`'s `ThreadEvent` union. | Medium — docs |
| `gemini.jsonl` | Transcribed from the `gemini --output-format stream-json` cheatsheet (littlebearapps.com) / `@google/gemini-cli-core` `JsonStreamEvent`. | Medium — docs |
| `copilot.jsonl` | Transcribed from GitHub's Copilot SDK "Streaming events" docs (session-events schema). | Medium — docs |

## Re-capturing a real transcript

```sh
# claude (already captured)
claude -p --output-format stream-json --include-partial-messages --verbose "…" > claude.jsonl

# codex
codex exec --json --skip-git-repo-check "…" > codex.jsonl

# gemini
gemini -p "…" --output-format stream-json > gemini.jsonl

# copilot
copilot -p "…" --output-format json --stream on --allow-all-tools > copilot.jsonl
```

opencode is not line-based (it streams SSE objects via `@opencode-ai/sdk`), so its
mapper `mapOpencodeEvent` is tested with inline object fixtures in the test file.
