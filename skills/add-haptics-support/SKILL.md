---
name: add-haptics-support
description: Add haptic feedback to a game with sdk.haptics, matched to how Puzzmo's own games use it
---

# Add Haptics Support

A game asks for a haptic by name and the host fires it:

```ts
sdk.haptics.play("selection")
```

That is the whole API. It is fire-and-forget, never awaited, and a no-op wherever the host cannot
deliver — the JSDoc on `sdk.haptics.play` covers where that is (real UIKit haptics in the iOS app,
an approximation via `navigator.vibrate` on web, nothing inside partner embeds) and why the game
cannot vibrate the device itself. Read it once; the rest of this skill is about _when_ to fire.

The hard part is taste, not wiring. What follows is how the eight Puzzmo games that ship haptics
actually use them, so a new game lands in the same place rather than inventing its own feel.

## The two rules worth internalising

**A haptic belongs on any moment that either has, or should have a sound.** Any meaningful interaction that would be cued by sound should also be cued by haptic. Examples are things like: Cards being dealt, items being picked up or dropped, keys or buttons being pressed.

Haptics are the _subset_ of your potential audio cues that the player caused and would want confirmed in
their hand. They are not a second, parallel feedback system.

**When in doubt, use `selection`. `selection` is the workhorse haptic, and other haptics should only be used in very limited circumstances.

## The six names we use

The host accepts nine names (`light`, `medium` and `soft` among them), but no Puzzmo game uses those
three — so there is no house precedent to match, and reaching for them puts a game on its own. Stick
to these six unless there is a reason not to.

### `selection` — the workhorse

Roughly two-thirds of all our haptics. Any discrete thing the player does to the board:

- **Bongo** — picking a letter up, dropping it, placing it on the grid, deleting with the keyboard,
  choosing a letter for the wild tile.
- **Pile-Up Poker** — picking a card up, dropping it, discarding it, dealing, opening and closing the
  reference panel. All fourteen card flips share it; the rank is differentiated in the sound, never
  in the haptic.
- **Really Bad Chess** — picking a piece up, putting it down, confirming a move.
- **Spelltower** — starting a selection, and each letter it grows by.
- **Flip Art** — every piece rotation.
- **Typeshift** — moving a column.

If unsure, this is the answer. A game whose haptics are all `selection` is a normal outcome —
Circuits ships exactly that.

`selection` is the only haptic that can be triggered immediately after itself. All other haptics require at least some time before being triggered again, or they get muddy.

### `success` — a milestone actually landed

Not "an action worked", but "something was achieved". Success is a two-beat haptic, like checking something off a todo list.

- **Spelltower** — a valid word forming, and committing it.
- **Typeshift** — a word found, and the puzzle won.
- **Memoku** — a valid match, a completed number set, finding a star, and the puzzle completing.
- **Flip Art** — the puzzle completing.
- **Pile-Up Poker** — starting the next round.
- **Really Bad Chess** — capturing one of _their_ pieces.

Puzzle completion is `success` in every game that marks it. It is not `heavy`.

### `rigid` — a heavier beat inside a burst

For a rapid run of events that needs to read as weightier than `selection` without escalating to a
milestone:

- **Pile-Up Poker** — the per-hand score ticker as it counts up, one beat per hand, with two of the
  twelve steps escalated to `success` to punctuate the run.
- **Bongo** — a word scoring, distinct from the individual letter placements around it.

This, not `medium`, is our answer to "this needs more weight than a tap". It can only be used for events that do not trigger again in close proximity.

### `warning` — respond to this, but you have not lost

- **Really Bad Chess** — either king going into check, on both sides of the board.

That is the only place we use it. It is a nudge, not a failure.

### `error` — a rejection or a loss you suffer

- **Memoku** — an invalid match.
- **Really Bad Chess** — losing one of _your_ pieces.

Note how sparing this is. Circuits deliberately gives an **incorrect submission** `selection`, not
`error` — a wrong guess there is a normal part of play, not a mistake worth buzzing about. Decide
which of those two a rejection is in _your_ game before reaching for `error`.

Really Bad Chess is the clearest illustration of the whole vocabulary: a capture plays the same
sound whichever way it goes, and only the haptic tells you whether it happened to you or for you —
`success` for theirs, `error` for yours.

### `heavy` — one terminal beat

- **Really Bad Chess** — checkmate.

Used once in the entire catalogue. Reserve it for a single dramatic, final moment; it loses all
meaning if it fires more than once a game.

## What we deliberately leave silent

About half of each game's sound cues carry no haptic at all, and that is design, not oversight. A
phone buzzing at something the player did not do reads as a bug.

- **Animation and physics.** Spelltower's letters falling off, columns collapsing, and the entire
  victory overlay dropping words one at a time — all audible, none felt. They are consequences, not
  inputs.
- **Chrome and modals.** Bongo's confirm and wild-tile windows appear and disappear with sound only.
- **The opponent.** Really Bad Chess plays a sound for the AI's move and fires no haptic, so the
  player only ever feels their own hand.
- **Distinctions that are audio's job.** Typeshift keeps _selecting_ a column distinct from _moving_
  one with a deliberately silent audio file, and gives the selection no haptic — only the move is
  felt.
- **Bootstrap and host-driven state.** Settings arriving, a restored in-progress game, the host's
  retry or reset.
- **No-op inputs.** Tapping an already-selected cell, an arrow at the board edge, an empty undo.

Shipping nothing is also legitimate.

## Density is per-game, not a target

Circuits fires five haptics in total. Pile-Up Poker fires thirty-five. Both are right. A game built
on continuous card and tile manipulation should be dense; a compose-then-submit game should be
sparse. Do not aim for "every interaction has one" — aim for "every interaction that has one earned
it".

Two practical limits:

- **One cue per gesture.** A drag should tick once per cell it crosses, never once per pointer event;
  a held key should tick per repeat the game acts on, not per key event.
- **Off iOS the host floors cues at 30ms apart** and drops anything faster, so a burst finer than
  that will be thinned on web. On that same path `success`, `warning` and `error` are multi-buzz
  patterns up to ~210ms long, so they are not interchangeable with a single tick in a fast sequence.

## If the game uses the Puzzmo on-screen keyboard

The host keyboard already fires `selection` on every key press. Do not fire another one in the
`keyboardKeyPress` handler, or the player feels each keystroke twice.

## Success Criteria

- The `build` script completes without errors
- Every haptic sits on a moment that also has a sound
- Only `selection`, `success`, `rigid`, `warning`, `error` and `heavy` are used
- Puzzle completion fires `success`
- Nothing fires during bootstrap, from animation, from host-driven state, or from an opponent's move
- Drags and held keys fire once per meaningful step, not once per input event
- The game never calls `navigator.vibrate` — it is blocked in the cross-origin iframe a game runs in
- Verified by ear on a device, or by asserting on the `SENSORY_EVENT` messages the SDK posts — the
  dev simulator has no haptics tab
