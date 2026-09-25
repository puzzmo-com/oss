/**
 * The PICO-8 bridge's wire format. PICO-8 mirrors the 128 bytes at 0x5f80 into a JavaScript array called
 * `pico8_gpio` once a frame, in both directions, and this splits them into two mailboxes. Each side only ever writes
 * to its own half: a byte written by both ends can lose one of the writes when the frame syncs.
 *
 * 0x00..0x3f  page -> cart   (only JavaScript writes)
 * 0x40..0x7f  cart -> page   (only Lua writes)
 *
 * Each mailbox holds one message:
 *
 * +0  seq   0 = nothing sent yet, else 1..255 wrapping back to 1
 * +1  op    opcode
 * +2  len   payload length, 0..60
 * +3  ack   the last seq this side has read from the other side
 * +4..+63   payload
 *
 * Ops below 16 belong to the bridge, a game uses 16 and up. The Lua half is in ./lua.ts.
 */

export const gpioSize = 128
export const pageBase = 0
export const cartBase = 64
export const maxPayload = 60

/** The first op a game can use for its own messages. */
export const firstGameOp = 16

/** Page -> cart */
export const PageOp = {
  /** `[flags]`, bit 0: this play was already completed. First thing sent after every BOOT. */
  HELLO: 1,
  /** 16 bytes: the PICO-8 hardware colour for each draw colour, applied with `pal(i, c, 1)` */
  PALETTE: 2,
  /** Everything is sent: the cart sets `pz.puzzle`, `pz.progress` and `pz.ready`, calls `pz_on_ready()`, and answers LOADED */
  READY: 3,
  /** The host started the game */
  START: 4,
  /** `[0 or 1]` */
  PAUSE: 5,
  /** The player restarted the puzzle */
  RETRY: 6,
  /** Up to 60 characters of the puzzle string. It arrives in pieces after HELLO, and READY marks the end. */
  PUZZLE_PART: 7,
  /** Up to 60 characters of the player's saved progress, the same way. */
  PROGRESS_PART: 8,
} as const

/** Cart -> page */
export const CartOp = {
  /** Sent from `pz_init()`, so again whenever the cart restarts */
  BOOT: 1,
  /** The cart has everything it needs to draw */
  LOADED: 2,
  /** The cart finished its victory animation, from `pz_finished()` */
  FINISHED: 3,
  /** 60 characters of progress from `pz_save()`, with more to come */
  SAVE_PART: 4,
  /** The last (or only) piece of progress from `pz_save()` */
  SAVE: 5,
  /** `[value hi, value lo, persist, ...id]` from `pz_deed()` */
  DEED: 6,
  /** `[points hi, points lo]` from `pz_complete()`, which saves the final progress just before */
  COMPLETE: 7,
} as const
