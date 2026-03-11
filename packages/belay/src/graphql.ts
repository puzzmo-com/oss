/**
 * A graphql tagged template literal function that returns the query string.
 * This allows using the Relay compiler for type generation without bundling relay-runtime.
 *
 * @example
 * ```ts
 * import { graphql } from '@puzzmo-com/belay'
 *
 * const MyQuery = graphql`
 *   query MyQuery {
 *     viewer { id }
 *   }
 * `
 * ```
 */
export const graphql = (strings: TemplateStringsArray): string => {
  return strings[0]!
}
