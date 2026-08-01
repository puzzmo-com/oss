# Puzzmo AT Protocol Lexicons

This directory contains the AT Protocol lexicon definitions for Puzzmo's custom schemas. They live in our private monorepo in the API.

They are mirrored to [`puzzmo-com/oss`](https://github.com/puzzmo-com/oss) under `lexicons/` on pushes to `prod-api`.

## Lexicons

| Lexicon             | Lives in            | Record key                      | What it is                                       |
| ------------------- | ------------------- | ------------------------------- | ------------------------------------------------ |
| `com.puzzmo.puzzle` | `puzzmo.com`'s repo | puzzle slug (e.g. `pl2o1a18wq`) | One puzzle, including its full playable data     |
| `com.puzzmo.daily`  | `puzzmo.com`'s repo | day string (e.g. `2026-08-01`)  | The set of puzzles published on a given day      |
| `com.puzzmo.streak` | _the player's_ repo | `teamSlug-gameSlug[-remixSlug]` | A player's streak for one game, signed by Puzzmo |

Goals:

- A `com.puzzmo.puzzle` record carries the whole puzzle in its `puzzle`
  field (for crosswords, the [xd format](https://github.com/century-arcade/xd)), not a pointer to our
  CDN. Someone can build a different crossword client on top of the archive without our permission
  and without our API, and it keeps working if we go away.
- `com.puzzmo.daily` gives every publishing day a stable AT URI, so a feed, a bot, or an archive can follow "what came out today"
- Authors, editors and hinters are structured `contributor`
  objects with an optional `did`, so a constructor's work is attributable to their atproto identity
  rather than to a string on our site.
- **Streaks belong to the player.** Streak records are written into the _player's own_ repo (opt-in,
  via OAuth), not ours. The player can take them to another app, and can delete them without asking
  us. Because a self-hosted record is trivially forgeable, each one carries an ES256 Keytrace attestation
  from Puzzmo — so a third party can tell "this player claims a 254-day streak" apart from "Puzzmo
  saw a 254-day streak".

### What actually gets published

Not everything on the site ends up on the network:

- Puzzles and dailies for our Crossword are posted
- Streaks are written on game completion, if you gave us permission to do it

## Using these from another app

You don't need anything from Puzzmo to read this data: no API key, no rate-limit deal, no
coordination with us. Records are public on the PDS holding the repo. All you need is a DID.

### Resolve the repo, then read records

```bash
# 1. handle -> DID
curl -s "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=puzzmo.com"
# {"did":"did:plc:p5ode5bkf6vjtt6ahtssuxui"}

# 2. DID -> PDS host (serviceEndpoint of #atproto_pds)
curl -s "https://plc.directory/did:plc:p5ode5bkf6vjtt6ahtssuxui" | jq '.service'

# 3. read a day, newest first
curl -s "https://amanita.us-east.host.bsky.network/xrpc/com.atproto.repo.listRecords\
?repo=did:plc:p5ode5bkf6vjtt6ahtssuxui&collection=com.puzzmo.daily&limit=5"

# 4. or fetch a known day directly, since the rkey is the date
curl -s "https://amanita.us-east.host.bsky.network/xrpc/com.atproto.repo.getRecord\
?repo=did:plc:p5ode5bkf6vjtt6ahtssuxui&collection=com.puzzmo.daily&rkey=2026-08-01"
```

The same three steps work for a player's streaks — resolve their handle, find their PDS (which is
usually _not_ a Bluesky-run host), and list `com.puzzmo.streak`.

### With `@atproto/api`

```ts
import { AtpAgent } from "@atproto/api"

// Any PDS will serve public records for repos it hosts; use the repo's own PDS.
const agent = new AtpAgent({
  service: "https://amanita.us-east.host.bsky.network",
})
const puzzmo = "did:plc:p5ode5bkf6vjtt6ahtssuxui"

const { data: daily } = await agent.com.atproto.repo.getRecord({
  repo: puzzmo,
  collection: "com.puzzmo.daily",
  rkey: "2026-08-01",
})

for (const ref of daily.value.puzzles) {
  const [, , did, collection, rkey] = ref.puzzleUri.split("/")
  const { data: puzzle } = await agent.com.atproto.repo.getRecord({
    repo: did,
    collection,
    rkey,
  })
  console.log(puzzle.value.name, "by", puzzle.value.authors?.[0]?.displayName)
  console.log(puzzle.value.puzzle) // xd source, parse with xd-crossword-tools
}
```

To react to new records as they land rather than polling, subscribe to a firehose/Jetstream
consumer filtered on the `com.puzzmo.*` collections.

## Worked examples

### A daily, from `puzzmo.com`'s repo

`at://did:plc:p5ode5bkf6vjtt6ahtssuxui/com.puzzmo.daily/2026-08-01`

```json
{
  "$type": "com.puzzmo.daily",
  "dayString": "2026-08-01T00:00:00.000Z",
  "seriesNumber": 1021,
  "createdAt": "2026-08-01T05:10:51.358Z",
  "puzzles": [
    {
      "puzzleUri": "at://did:plc:p5ode5bkf6vjtt6ahtssuxui/com.puzzmo.puzzle/pl2o1a18wq",
      "url": "https://www.puzzmo.com/puzzle/2026-08-01/crossword"
    }
  ]
}
```

### The puzzle it points at

`at://did:plc:p5ode5bkf6vjtt6ahtssuxui/com.puzzmo.puzzle/pl2o1a18wq`

```json
{
  "$type": "com.puzzmo.puzzle",
  "name": "Off the Rails",
  "emoji": "🔧",
  "gameSlug": "crossword",
  "gameDisplayName": "Cross|word",
  "difficulty": 8,
  "createdAt": "2026-07-28T19:22:02.271Z",
  "url": "https://www.puzzmo.com/puzzle/2026-08-01/crossword",
  "playUrl": "https://www.puzzmo.com/puzzle/2026-08-01/crossword",
  "authors": [
    {
      "type": "author",
      "displayName": "Ryan Mathiason",
      "avatarUrl": "https://cdn.puzzmo.com/avatars/47.png"
    }
  ],
  "editors": [
    {
      "type": "editor",
      "displayName": "Joe Deeney",
      "avatarUrl": "https://cdn.puzzmo.com/avatars/34.png"
    }
  ],
  "hinters": [
    {
      "type": "hinter",
      "displayName": "Matthew Stock",
      "avatarUrl": "https://cdn.puzzmo.com/avatars/43.png"
    }
  ],
  "publications": [
    {
      "publishedAt": "2026-08-01T00:00:00.000Z",
      "seriesNumber": 1021,
      "url": "https://www.puzzmo.com/puzzle/2026-08-01/crossword",
      "did": "at://did:plc:p5ode5bkf6vjtt6ahtssuxui/com.puzzmo.daily/2026-08-01"
    }
  ],
  "completionNotes": "This theme started after talking about the [`TROLLEY PROBLEM`](#15A) in a philosophy class...",
  "editorsNotes": "Ryan's apt pair today is great on its own, but the parallel clues for the [theme](#15A) [answers](#30A) really elevates it...",
  "puzzle": "## Metadata\n\ntitle: Off the Rails\nauthor: Ryan Mathiason\n...\n\n## Grid\n\nMECCA..TAP.BAG\nAURAS.HAIR.AXE\nTROLLEYPROBLEM\n..."
}
```

The `puzzle` string here is ~6KB of xd: metadata block, grid, then across/down clues. That is the
entire playable puzzle.

### A streak, from a player's repo (`orta.io`)

Streaks live with the player, on their own PDS. `orta.io` is `did:plc:t732otzqvkch7zz5d37537ry`,
hosted on `npmx.social` rather than a Bluesky PDS:

```bash
curl -s "https://npmx.social/xrpc/com.atproto.repo.listRecords\
?repo=did:plc:t732otzqvkch7zz5d37537ry&collection=com.puzzmo.streak"
```

which currently returns five records — `puzzmo-crossword`, `puzzmo-crossword-mini-xword`,
`puzzmo-flip-art`, `puzzmo-ribbit`, `puzzmo-circuits`. Note the third rkey segment: the Mini is a
remix of Crossword with its own streak, so it gets its own record.

`at://did:plc:t732otzqvkch7zz5d37537ry/com.puzzmo.streak/puzzmo-crossword`

```json
{
  "$type": "com.puzzmo.streak",
  "teamSlug": "puzzmo",
  "gameSlug": "crossword",
  "gameDisplayName": "Cross|word",
  "current": 1,
  "max": 7,
  "total": 254,
  "lastUpdated": "2026-07-16T05:00:00.000Z",
  "syncedAt": "2026-07-16T16:52:39.784Z",
  "sigs": [
    {
      "kid": "0f1063cb-81b8-4299-9dc6-f8d03366de56",
      "src": "at://did:plc:p5ode5bkf6vjtt6ahtssuxui/dev.keytrace.serverPublicKey/signing-keys-1",
      "signedAt": "2026-07-16T16:52:39.784Z",
      "attestation": "eyJhbGciOiJFUzI1NiIsImtpZCI6IjBmMTA2M2NiLTgxYjgtNDI5OS05ZGM2LWY4ZDAzMzY2ZGU1NiJ9.eyJjdXJyZW50IjoxLCJnYW1lRGlzcGxheU5hbWUiOiJDcm9zc3x3b3JkIiwiZ2FtZVNsdWciOiJjcm9zc3dvcmQiLCJsYXN0VXBkYXRlZCI6IjIwMjYtMDctMTZUMDU6MDA6MDAuMDAwWiIsIm1heCI6NywidGVhbVNsdWciOiJwdXp6bW8iLCJ0b3RhbCI6MjU0fQ.83x_s1PSucfr2TXZ15Q4KDrJT0sC8YnbsrCl_xv5m4rm_dN5qlY0-We4XjgifFsy7tJ6dSEopvs_OIFAvGcVQg",
      "signedFields": ["current", "gameDisplayName", "gameSlug", "lastUpdated", "max", "remixSlug", "teamSlug", "total"]
    }
  ]
}
```

## Verifying a streak attestation

The record sits in the player's repo, so they could have written anything into it. `sigs` is what
makes it trustworthy: a compact ES256 JWS over the [JCS](https://www.rfc-editor.org/rfc/rfc8785)
canonicalization of the streak fields, produced by Puzzmo. `src` is an AT URI pointing at the
public key record in _our_ repo, so verification needs nothing from us but a public fetch.

```ts
import canonicalize from "canonicalize"
import { compactVerify, importJWK } from "jose"

const { value } = await getRecord(playerDid, "com.puzzmo.streak", "puzzmo-crossword")
const { sigs, syncedAt, $type, ...signedData } = value
const sig = sigs[0]

// Resolve the signing key via sig.src, not sig.kid — the key records have no kid field.
const [, , did, collection, rkey] = sig.src.split("/")
const keyRecord = await getRecord(did, collection, rkey) // dev.keytrace.serverPublicKey
const key = await importJWK({ ...JSON.parse(keyRecord.publicJwk), key_ops: ["verify"] }, "ES256")

const { payload } = await compactVerify(sig.attestation, key)
const ok = new TextDecoder().decode(payload) === canonicalize(signedData)
```

Two things to check beyond `ok`: that `did` really is Puzzmo's DID (a forger can point `src` at
their own key record), and that the key record's `validFrom`/`validUntil` bracket `sig.signedAt`.

Everything except `sigs` and `syncedAt` is inside the signed payload, so `current`, `max`, `total`
and `lastUpdated` cannot be edited without breaking verification. `syncedAt` is deliberately
outside it and is not attested.

## Gotchas for consumers

- `publication.did` holds an **AT URI to the daily record**, not a DID. The field name is wrong and
  is kept for compatibility.
- `daily.dayString` is typed as a datetime and always lands at midnight UTC, but the day it names is
  Puzzmo's publishing day. The record key (`2026-08-01`) is the more reliable form.
- `gameDisplayName` contains `|` as a soft line-break hint for our layout — `"Cross|word"`,
  `"Big Cross|word"`. Strip it before display.
- `sig.signedFields` is derived from the object's keys before undefined values are dropped, so it
  can list a field (typically `remixSlug`) that is absent from the signed payload. Verify against
  the canonicalized record, not against `signedFields`.
- Puzzle records are written with `putRecord` keyed on the puzzle slug, so a puzzle can be revised
  in place; the daily's `puzzleUri` stays valid, but the CID changes.
- `com.puzzmo.streak` uses `key: "any"` while the other two use `key: "tid"` — despite the lexicon
  saying `tid`, puzzle and daily rkeys are slugs and dates, not TIDs.

## Deploying Lexicons

### Prerequisites

Install the goat CLI tool:

```bash
# macOS
brew install bluesky-social/tap/goat

# Or with Go
go install github.com/bluesky-social/goat@latest
```

### Deploy

Run the deployment script:

```bash
yarn workspace api script DeployBlueskyLexicons
```

This will push the lexicons to the AT Protocol network using the Puzzmo Bluesky account.

### Environment Variables

The deployment script requires:

- `PUZZMO_BSKY_IDENTIFIER` - Bluesky handle (defaults to "puzzmo.com")
- `PUZZMO_COM_BSKY_APP_PASSWORD` - App password for authentication

## Development

### Validate Lexicons

To validate lexicons locally (run from lexicons directory):

```bash
cd src/lib/bluesky/lexicons
goat lex lint
```

### Check Lexicon Status

To check differences with the live network:

```bash
cd src/lib/bluesky/lexicons
goat account login -u puzzmo.com -p <password>
goat lex status
goat account logout
```

### Manual Deployment

To manually deploy lexicons (run from lexicons directory):

```bash
cd src/lib/bluesky/lexicons
goat account login -u puzzmo.com -p <password>
goat lex lint
goat lex publish
goat account logout
```

## References

- [AT Protocol Lexicon Spec](https://atproto.com/specs/lexicon)
- [Lexicon Style Guide](https://atproto.com/guides/lexicon-style-guide)
- [goat CLI](https://github.com/bluesky-social/goat)
