/**
 * @generated SignedSource<<892c3aa4f6c7673e590b4a9bcc8514c2>>
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
export type cliAddPuzzlesToPoolMutation$variables = {
  gameSlug: string;
  puzzles: ReadonlyArray<McpPuzzleFileInput>;
  token: string;
};
export type cliAddPuzzlesToPoolMutation$data = {
  readonly addPuzzlesToPool: {
    readonly failed: ReadonlyArray<{
      readonly filename: string;
      readonly message: string;
    }>;
    readonly poolCount: number;
    readonly uploadedFilenames: ReadonlyArray<string>;
  } | null | undefined;
};
export type cliAddPuzzlesToPoolMutation = {
  response: cliAddPuzzlesToPoolMutation$data;
  variables: cliAddPuzzlesToPoolMutation$variables;
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
    "concreteType": "McpPoolUploadResult",
    "kind": "LinkedField",
    "name": "addPuzzlesToPool",
    "plural": false,
    "selections": [
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "uploadedFilenames",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "concreteType": "McpPoolUploadFailure",
        "kind": "LinkedField",
        "name": "failed",
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
            "name": "message",
            "storageKey": null
          }
        ],
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "poolCount",
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
    "name": "cliAddPuzzlesToPoolMutation",
    "selections": (v3/*:: as any*/),
    "type": "Mutation",
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
    "name": "cliAddPuzzlesToPoolMutation",
    "selections": (v3/*:: as any*/)
  },
  "params": {
    "cacheID": "a779ada059e34a22a12c7175df0e50fc",
    "id": null,
    "metadata": {},
    "name": "cliAddPuzzlesToPoolMutation",
    "operationKind": "mutation",
    "text": "mutation cliAddPuzzlesToPoolMutation(\n  $token: String!\n  $gameSlug: String!\n  $puzzles: [McpPuzzleFileInput!]!\n) {\n  addPuzzlesToPool(token: $token, gameSlug: $gameSlug, puzzles: $puzzles) {\n    uploadedFilenames\n    failed {\n      filename\n      message\n    }\n    poolCount\n  }\n}\n"
  }
};
})();

(node as any).hash = "f79544fe70b713f8304a444df02b2016";

export default node;
