import { maxPayload } from "./protocol"

/** One message on the wire. */
export type Pico8Message = { op: number; payload: number[] }

/** Anything indexable as bytes, in practice the `pico8_gpio` array. */
export type Pico8Memory = { [index: number]: number | undefined; length: number }

const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n) || 0))

/**
 * One end of a GPIO mailbox pair. The cart runs the same algorithm in Lua (`pz_update` in ./lua.ts).
 *
 * A message is written payload first and `seq` last, so a half-synced message is never read as a whole one. The
 * sender holds it until the other side's `ack` matches, and writes it again (under the same `seq`) if no ack arrives,
 * so a repeat is ignored by a side that already has it. The `ack` is restated every tick, because an ack lost to a
 * sync race would otherwise leave the other side waiting forever on a message which was delivered.
 */
export class Pico8Channel {
  private inSeq = 0
  private outSeq = 0
  private pending: Pico8Message | null = null
  private wait = 0
  private queue: Pico8Message[] = []

  /**
   * @param mem The shared 128 bytes
   * @param myBase Offset of the half this end writes
   * @param peerBase Offset of the half this end reads
   * @param resendAfter Ticks to wait for an ack before writing a message again
   */
  constructor(
    private mem: Pico8Memory,
    private myBase: number,
    private peerBase: number,
    private resendAfter = 20,
  ) {}

  /** Queues a message. They go out one per tick, in order. */
  send(op: number, payload: ArrayLike<number> = []) {
    if (payload.length > maxPayload) throw new Error(`PICO-8 payloads are at most ${maxPayload} bytes, op ${op} has ${payload.length}`)
    this.queue.push({ op: clampByte(op), payload: Array.from(payload, clampByte) })
  }

  /** Messages still to be delivered, including one waiting on an ack. */
  get backlog() {
    return this.queue.length + (this.pending ? 1 : 0)
  }

  /** Reads at most one message and writes at most one. Call once per frame. */
  tick(): Pico8Message[] {
    const received: Pico8Message[] = []

    const seq = this.read(this.peerBase)
    if (this.inSeq !== 0) this.write(this.myBase + 3, this.inSeq)
    if (seq !== 0 && seq !== this.inSeq) {
      this.inSeq = seq
      this.write(this.myBase + 3, seq)
      const len = Math.min(this.read(this.peerBase + 2), maxPayload)
      const payload: number[] = []
      for (let i = 0; i < len; i++) payload.push(this.read(this.peerBase + 4 + i))
      received.push({ op: this.read(this.peerBase + 1), payload })
    }

    if (this.pending && this.read(this.peerBase + 3) === this.outSeq) this.pending = null

    let message = this.pending
    if (message) {
      if (++this.wait < this.resendAfter) return received
    } else {
      message = this.queue.shift() ?? null
      if (!message) return received
      this.outSeq = (this.outSeq % 255) + 1
    }

    for (let i = 0; i < maxPayload; i++) this.write(this.myBase + 4 + i, message.payload[i] ?? 0)
    this.write(this.myBase + 1, message.op)
    this.write(this.myBase + 2, message.payload.length)
    this.write(this.myBase, this.outSeq) // seq last: it commits the message
    this.pending = message
    this.wait = 0
    return received
  }

  private read(i: number) {
    const v = this.mem[i]
    return typeof v === "number" && v >= 0 ? v & 0xff : 0
  }

  private write(i: number, v: number) {
    this.mem[i] = clampByte(v)
  }
}
