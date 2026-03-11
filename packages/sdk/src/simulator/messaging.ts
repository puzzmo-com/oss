import type { MessagesReceived } from "../types"
import type { MessageLogEntry } from "./types"

export interface MessageLogger {
  log: (type: string, data: any, direction: "in" | "out") => void
  clear: () => void
  getLog: () => MessageLogEntry[]
}

export function createMessageLogger(onLog?: (entry: MessageLogEntry) => void): MessageLogger {
  const messageLog: MessageLogEntry[] = []

  return {
    log(type: string, data: any, direction: "in" | "out") {
      const time = new Date().toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
      const entry: MessageLogEntry = { type, data, time, direction }
      messageLog.push(entry)

      // Limit log size
      if (messageLog.length > 100) messageLog.shift()

      onLog?.(entry)
    },
    clear() {
      messageLog.length = 0
    },
    getLog() {
      return messageLog
    },
  }
}

export function sendToGame(type: keyof MessagesReceived, data: any, logger?: MessageLogger): void {
  console.log("Simulator sending:", type, data)
  logger?.log(type, data, "out")
  window.postMessage({ type, data }, "*")
}

export type MessageHandler = (type: string, data: any) => void

export function createMessageListener(handler: MessageHandler, logger?: MessageLogger): () => void {
  const listener = (event: MessageEvent) => {
    if (!event?.data?.type) return

    const type = event.data.type
    // Handle both { data } and { json } formats from host
    const data = event.data.data ?? event.data.json ?? {}

    // Skip logging for high-frequency timer messages
    const skipLogTypes = ["TIMER_TICK", "TIMER_SYNC"]
    if (!skipLogTypes.includes(type)) {
      logger?.log(type, data, "in")
    }

    handler(type, data)
  }

  window.addEventListener("message", listener)

  // Return cleanup function
  return () => window.removeEventListener("message", listener)
}
