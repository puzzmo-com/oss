/**
 * @generated SignedSource<<8b45a4259087b0ba56f45d09b2de210b>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type McpPuzzleFileInput = {
  content: string;
  filename: string;
};
export type cliValidatePoolPuzzlesQuery$variables = {
  gameSlug: string;
  puzzles: ReadonlyArray<McpPuzzleFileInput>;
  token: string;
};
export type cliValidatePoolPuzzlesQuery$data = {
  readonly validatePoolPuzzles: ReadonlyArray<{
    readonly errors: ReadonlyArray<string>;
    readonly filename: string;
    readonly valid: boolean;
  }> | null | undefined;
};
export type cliValidatePoolPuzzlesQuery = {
  response: cliValidatePoolPuzzlesQuery$data;
  variables: cliValidatePoolPuzzlesQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "gameSlug"
},
v1 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "puzzles"
},
v2 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "token"
},
v3 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "gameSlug",
        "variableName": "gameSlug"
      },
      {
        "kind": "Variable",
        "name": "puzzles",
        "variableName": "puzzles"
      },
      {
        "kind": "Variable",
        "name": "token",
        "variableName": "token"
      }
    ],
    "concreteType": "McpPoolPuzzleValidation",
    "kind": "LinkedField",
    "name": "validatePoolPuzzles",
    "plural": true,
    "selections": [
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "filename",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "valid",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "errors",
        "storageKey": null
      }
    ],
    "storageKey": null
  }
];
return {
  "fragment": {
    "argumentDefinitions": [
      (v0/*:: as any*/),
      (v1/*:: as any*/),
      (v2/*:: as any*/)
    ],
    "kind": "Fragment",
    "metadata": null,
    "name": "cliValidatePoolPuzzlesQuery",
    "selections": (v3/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [
      (v2/*:: as any*/),
      (v0/*:: as any*/),
      (v1/*:: as any*/)
    ],
    "kind": "Operation",
    "name": "cliValidatePoolPuzzlesQuery",
    "selections": (v3/*:: as any*/)
  },
  "params": {
    "cacheID": "934ec64898f9b820ebc69f223fd50cc5",
    "id": null,
    "metadata": {},
    "name": "cliValidatePoolPuzzlesQuery",
    "operationKind": "query",
    "text": "query cliValidatePoolPuzzlesQuery(\n  $token: String!\n  $gameSlug: String!\n  $puzzles: [McpPuzzleFileInput!]!\n) {\n  validatePoolPuzzles(token: $token, gameSlug: $gameSlug, puzzles: $puzzles) {\n    filename\n    valid\n    errors\n  }\n}\n"
  }
};
})();

(node as any).hash = "08673f877fe016f880516c4a9fdcf03d";

export default node;
