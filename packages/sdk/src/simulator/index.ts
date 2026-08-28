export { createSimulator } from "./createSimulator"
export { simulatorBuildMarker } from "./marker"
// The Sound tab is built in, but exported so hosts embedding the simulator can reuse it directly.
export { createSoundView } from "./views"
export type { SimulatorConfig, FixtureImports, SimulatorView, SimulatorContext, HostContextPreset } from "./types"
