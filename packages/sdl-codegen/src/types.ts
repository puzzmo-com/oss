import type { SDLCodeGenSystem } from "./system.js"

export interface SDLCodeGenOptions {
  /** We'll use a node fs-backed one if it isn't given */
  system?: SDLCodeGenSystem
}

// These are directly ported from Redwood at
// packages/project-config/src/paths.ts

// Slightly amended to reduce the constraints on the Redwood team to make changes to this obj!

interface NodeTargetPaths {
  base: string
  config: string
  // dataMigrations: string
  // db: string
  dbSchema: string
  directives: string
  // dist: string
  // functions: string
  // generators: string
  graphql: string
  lib: string
  models: string
  services: string
  src: string
  types: string
}

export interface RedwoodPaths {
  api: NodeTargetPaths
  base: string
  generated: {
    // base: string
    // prebuild: string
    schema: string
    // types: {
    // 	includes: string
    // 	mirror: string
    // }
  }
  scripts: string
  web: object
}
