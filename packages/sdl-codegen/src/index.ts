import * as graphql from "graphql"
import { basename, join } from "node:path"
import { Project } from "ts-morph"

import { getSchema as getPrismaSchema } from "@mrleebo/prisma-ast"

import { AppContext } from "./context.js"
import { PrismaMap, prismaModeller } from "./prismaModeller.js"
import { lookAtServiceFile } from "./serviceFile.js"
import { createSharedSchemaFiles } from "./sharedSchema.js"
import { createNodeSystem, SDLCodeGenSystem } from "./system.js"
import { CodeFacts, FieldFacts } from "./typeFacts.js"
import { RedwoodPaths } from "./types.js"
import { makeStep } from "./utils.js"

export * from "./system.js"
export * from "./types.js"

export interface SDLCodeGenWatcher {
  /** Called when a file is changed by the host's file watcher. */
  fileChanged: (path: string) => void
  /**
   * Force a re-read of the generated GraphQL schema and a full re-run of codegen
   * for all services. Use this when the host writes the schema to a path that the
   * file watcher does not observe (e.g. it lives outside the watched root), so
   * that subsequent service file changes are validated against the latest schema.
   */
  schemaChanged: () => void
}

export interface SDLCodeGenReturn {
  // Optional way to start up a watcher mode for the codegen
  createWatcher: () => SDLCodeGenWatcher
  // Paths which were added/changed during the run
  paths: string[]
}

/** The API specifically for the Redwood preset */
export async function runFullCodegen(
  preset: "redwood",
  config: { paths: RedwoodPaths; sys?: SDLCodeGenSystem; verbose?: true },
): Promise<SDLCodeGenReturn>

export async function runFullCodegen(preset: string, config: unknown): Promise<SDLCodeGenReturn>

export async function runFullCodegen(preset: string, config: unknown): Promise<SDLCodeGenReturn> {
  if (preset !== "redwood") throw new Error("Only Redwood codegen is supported at this time")
  const verbose = !!(config as { verbose?: true }).verbose
  const startTime = Date.now()
  const step = makeStep(verbose)

  const paths = (config as { paths: RedwoodPaths }).paths
  const sys = (config as { sys?: SDLCodeGenSystem }).sys ?? createNodeSystem()

  const pathSettings: AppContext["pathSettings"] = {
    root: paths.base,
    apiServicesPath: paths.api.services,
    prismaDSLPath: paths.api.dbSchema,
    graphQLSchemaPath: paths.generated.schema,
    sharedFilename: "shared-schema-types.d.ts",
    sharedInternalFilename: "shared-return-types.d.ts",
    typesFolderRoot: paths.api.types,
  }

  const project = new Project({ useInMemoryFileSystem: true })

  let gqlSchema: graphql.GraphQLSchema | undefined
  const getGraphQLSDLFromFile = (settings: AppContext["pathSettings"]) => {
    const schema = sys.readFile(settings.graphQLSchemaPath)
    if (!schema) throw new Error("No schema found at " + settings.graphQLSchemaPath)
    gqlSchema = graphql.buildSchema(schema)
  }

  let prismaSchema: PrismaMap = new Map()
  const getPrismaSchemaFromFile = (settings: AppContext["pathSettings"]) => {
    const isDirectory = sys.directoryExists(settings.prismaDSLPath)
    if (isDirectory) {
      const prismaFiles = sys.readDirectory(settings.prismaDSLPath, [".prisma"])
      if (!prismaFiles.length) throw new Error("No .prisma files found in " + settings.prismaDSLPath)
      const mergedList: ReturnType<typeof getPrismaSchema>["list"] = []
      for (const filePath of prismaFiles) {
        const text = sys.readFile(filePath)
        if (!text) throw new Error("Could not read prisma file at " + filePath)
        mergedList.push(...getPrismaSchema(text).list)
      }
      prismaSchema = prismaModeller({ type: "schema", list: mergedList })
    } else {
      const prismaSchemaText = sys.readFile(settings.prismaDSLPath)
      if (!prismaSchemaText) throw new Error("No prisma file found at " + settings.prismaDSLPath)
      prismaSchema = prismaModeller(getPrismaSchema(prismaSchemaText))
    }
  }

  step("Read the GraphQL schema", () => getGraphQLSDLFromFile(pathSettings))
  step("Read the Prisma schema", () => getPrismaSchemaFromFile(pathSettings))

  if (!gqlSchema) throw new Error("No GraphQL Schema was created during setup")

  const appContext: AppContext = {
    gql: gqlSchema,
    prisma: prismaSchema,
    tsProject: project,
    codeFacts: new Map<string, CodeFacts>(),
    fieldFacts: new Map<string, FieldFacts>(),
    pathSettings,
    sys,
    join,
    basename,
  }

  // All changed files
  const filepaths = [] as string[]

  let knownServiceFiles: string[] = []
  const createDTSFilesForAllServices = () => {
    const serviceFiles = appContext.sys.readDirectory(appContext.pathSettings.apiServicesPath)
    knownServiceFiles = serviceFiles.filter(isRedwoodServiceFile)

    for (const path of knownServiceFiles) {
      const dts = lookAtServiceFile(path, appContext)
      if (dts) filepaths.push(dts)
    }
  }

  // Scan service files first so that appContext.fieldFacts is populated before the
  // shared schema gen reads it to decide field optionality. Without this ordering,
  // a fresh codegen run writes shared types with fieldFacts empty (resolver-backed
  // fields appear required), while watcher re-runs see populated fieldFacts and
  // write the same fields as optional - producing flapping diffs in the generated
  // shared-schema-types.d.ts / shared-return-types.d.ts files.
  step("Create DTS files for all services", createDTSFilesForAllServices)

  // Create the two shared schema files
  step("Create shared schema files", () => {
    const sharedDTSes = createSharedSchemaFiles(appContext, verbose)
    filepaths.push(...sharedDTSes)
  })

  const endTime = Date.now()
  const timeTaken = endTime - startTime
  if (verbose) console.log(`[sdl-codegen]: Full run took ${timeTaken}ms`)

  const createWatcher = (): SDLCodeGenWatcher => {
    let oldSDL = ""

    const schemaChanged = () => {
      const newSDL = appContext.sys.readFile(appContext.pathSettings.graphQLSchemaPath)
      if (!newSDL || newSDL === oldSDL) return

      if (verbose) console.log("[sdl-codegen] SDL Schema changed")
      oldSDL = newSDL
      step("GraphQL schema changed", () => getGraphQLSDLFromFile(appContext.pathSettings))
      // Service files must be processed before the shared schema is regenerated so
      // that appContext.fieldFacts is up to date for the shared schema's
      // optionality decisions. See the comment in the initial run above.
      step("Create all service files", createDTSFilesForAllServices)
      step("Create all shared schema files", () => createSharedSchemaFiles(appContext, verbose))
    }

    return {
      fileChanged: (path: string) => {
        if (isTypesFile(path)) return
        if (path === appContext.pathSettings.graphQLSchemaPath) {
          schemaChanged()
        } else if (isPrismaSchemaPath(path, appContext.pathSettings.prismaDSLPath, sys)) {
          step("Prisma schema changed", () => getPrismaSchemaFromFile(appContext.pathSettings))
          step("Create all shared schema files", createDTSFilesForAllServices)
        } else if (isRedwoodServiceFile(path)) {
          if (!knownServiceFiles.includes(path)) {
            step("Create all shared schema files", createDTSFilesForAllServices)
          } else {
            step("Create known service files", () => lookAtServiceFile(path, appContext))
          }
        }
      },
      schemaChanged,
    }
  }

  return {
    paths: filepaths,
    createWatcher,
  }
}

const isTypesFile = (file: string) => file.endsWith(".d.ts")

const isPrismaSchemaPath = (changedPath: string, prismaDSLPath: string, sys: SDLCodeGenSystem) => {
  if (changedPath === prismaDSLPath) return true
  if (sys.directoryExists(prismaDSLPath) && changedPath.startsWith(prismaDSLPath) && changedPath.endsWith(".prisma")) return true
  return false
}

const isRedwoodServiceFile = (file: string) => {
  if (!file.includes("services")) return false
  if (file.endsWith(".d.ts")) return false
  if (file.endsWith(".test.ts") || file.endsWith(".test.js")) return false
  if (file.endsWith("scenarios.ts") || file.endsWith("scenarios.js")) return false
  return file.endsWith(".ts") || file.endsWith(".tsx") || file.endsWith(".js")
}
