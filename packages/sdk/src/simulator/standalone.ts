/**
 * Standalone entry point for the simulator.
 *
 * Use as a script tag for non-Vite setups:
 * ```html
 * <script>
 *   window.SIMULATOR_CONFIG = { slug: "my-game" }
 * </script>
 * <script src="https://cdn.jsdelivr.net/npm/@puzzmo/sdk/dist/simulator/standalone.js"></script>
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
