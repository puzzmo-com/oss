import * as graphql from "graphql"
import * as tsMorph from "ts-morph"

import { PrismaMap } from "./prismaModeller.js"
import { SDLCodeGenSystem } from "./system.js"
import { CodeFacts, FieldFacts } from "./typeFacts.js"

export interface AppContext {
  /** POSIX-y fn not built into System */
  basename: (path: string) => string
  /** "service" should be code here */
  codeFacts: Map<string, CodeFacts>
  /** A global set of facts about resolvers focused from the GQL side */
  fieldFacts: Map<string, FieldFacts>
  /** So you can override the formatter */
  gql: graphql.GraphQLSchema
  /** POSXIY- fn not built into System */
  join: (...paths: string[]) => string
  /** Where to find particular files */
  pathSettings: {
    apiServicesPath: string
    graphQLSchemaPath: string
    prismaDSLPath: string
    root: string
    sharedFilename: string
    sharedInternalFilename: string
    typesFolderRoot: string
  }

  /** A map of prisma models */
  prisma: PrismaMap
  /**
   * The filesystem sdl-codegen reads and writes through - defaults to node's fs,
   * but you can pass your own (e.g. an in-memory one in browsers).
   */
  sys: SDLCodeGenSystem
  /**
   * Ts-morph is used to abstract over the typescript compiler API, this project file
   * is a slightly augmented version of the typescript Project api.
   */
  tsProject: tsMorph.Project
}
