/**
 * Standalone entry point for the simulator.
 *
 * Use as an IIFE script tag for non-Vite setups:
 * ```html
 * <script>
 *   window.SIMULATOR_CONFIG = { puzzlePath: "./sample-puzzle.json" }
 * </script>
 * <script src="path/to/simulator/standalone.iife.js"></script>
 * ```
 */
import { createSimulator } from "./createSimulator"
import type { SimulatorConfig } from "./types"

declare global {
  interface Window {
    SIMULATOR_CONFIG?: SimulatorConfig
  }
}

const init = () => {
  const config = window.SIMULATOR_CONFIG ?? {}
  createSimulator(config)
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init)
} else {
  init()
}
