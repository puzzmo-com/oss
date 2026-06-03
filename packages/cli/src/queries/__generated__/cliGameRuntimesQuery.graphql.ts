/**
 * @generated SignedSource<<5f5ceed697fe8720947305fca5196bee>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type cliGameRuntimesQuery$variables = {
  token: string;
};
export type cliGameRuntimesQuery$data = {
  readonly teamForToken: {
    readonly games: {
      readonly edges: ReadonlyArray<{
        readonly node: {
          readonly runtime: {
            readonly currentVersion: {
              readonly assetsSha: string;
            } | null | undefined;
            readonly nextVersion: {
              readonly assetsSha: string;
            } | null | undefined;
            readonly previousVersion: {
              readonly assetsSha: string;
            } | null | undefined;
          } | null | undefined;
          readonly slug: string;
        };
      } | null | undefined> | null | undefined;
    };
    readonly slug: string;
  } | null | undefined;
};
export type cliGameRuntimesQuery = {
  response: cliGameRuntimesQuery$data;
  variables: cliGameRuntimesQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "token"
  }
],
v1 = [
  {
    "kind": "Variable",
    "name": "token",
    "variableName": "token"
  }
],
v2 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "slug",
  "storageKey": null
},
v3 = [
  {
    "kind": "Literal",
    "name": "first",
    "value": 500
  }
],
v4 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "assetsSha",
  "storageKey": null
},
v5 = [
  (v4/*:: as any*/)
],
v6 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v7 = [
  (v4/*:: as any*/),
  (v6/*:: as any*/)
];
return {
  "fragment": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "cliGameRuntimesQuery",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": "Team",
        "kind": "LinkedField",
        "name": "teamForToken",
        "plural": false,
        "selections": [
          (v2/*:: as any*/),
          {
            "alias": null,
            "args": (v3/*:: as any*/),
            "concreteType": "GameConnection",
            "kind": "LinkedField",
            "name": "games",
            "plural": false,
            "selections": [
              {
                "alias": null,
                "args": null,
                "concreteType": "GameEdge",
                "kind": "LinkedField",
                "name": "edges",
                "plural": true,
                "selections": [
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "Game",
                    "kind": "LinkedField",
                    "name": "node",
                    "plural": false,
                    "selections": [
                      (v2/*:: as any*/),
                      {
                        "alias": null,
                        "args": null,
                        "concreteType": "GameRuntime",
                        "kind": "LinkedField",
                        "name": "runtime",
                        "plural": false,
                        "selections": [
                          {
                            "alias": null,
                            "args": null,
                            "concreteType": "GameRuntimeVersion",
                            "kind": "LinkedField",
                            "name": "currentVersion",
                            "plural": false,
                            "selections": (v5/*:: as any*/),
                            "storageKey": null
                          },
                          {
                            "alias": null,
                            "args": null,
                            "concreteType": "GameRuntimeVersion",
                            "kind": "LinkedField",
                            "name": "nextVersion",
                            "plural": false,
                            "selections": (v5/*:: as any*/),
                            "storageKey": null
                          },
                          {
                            "alias": null,
                            "args": null,
                            "concreteType": "GameRuntimeVersion",
                            "kind": "LinkedField",
                            "name": "previousVersion",
                            "plural": false,
                            "selections": (v5/*:: as any*/),
                            "storageKey": null
                          }
                        ],
                        "storageKey": null
                      }
                    ],
                    "storageKey": null
                  }
                ],
                "storageKey": null
              }
            ],
            "storageKey": "games(first:500)"
          }
        ],
        "storageKey": null
      }
    ],
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "cliGameRuntimesQuery",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": "Team",
        "kind": "LinkedField",
        "name": "teamForToken",
        "plural": false,
        "selections": [
          (v2/*:: as any*/),
          {
            "alias": null,
            "args": (v3/*:: as any*/),
            "concreteType": "GameConnection",
            "kind": "LinkedField",
            "name": "games",
            "plural": false,
            "selections": [
              {
                "alias": null,
                "args": null,
                "concreteType": "GameEdge",
                "kind": "LinkedField",
                "name": "edges",
                "plural": true,
                "selections": [
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "Game",
                    "kind": "LinkedField",
                    "name": "node",
                    "plural": false,
                    "selections": [
                      (v2/*:: as any*/),
                      {
                        "alias": null,
                        "args": null,
                        "concreteType": "GameRuntime",
                        "kind": "LinkedField",
                        "name": "runtime",
                        "plural": false,
                        "selections": [
                          {
                            "alias": null,
                            "args": null,
                            "concreteType": "GameRuntimeVersion",
                            "kind": "LinkedField",
                            "name": "currentVersion",
                            "plural": false,
                            "selections": (v7/*:: as any*/),
                            "storageKey": null
                          },
                          {
                            "alias": null,
                            "args": null,
                            "concreteType": "GameRuntimeVersion",
                            "kind": "LinkedField",
                            "name": "nextVersion",
                            "plural": false,
                            "selections": (v7/*:: as any*/),
                            "storageKey": null
                          },
                          {
                            "alias": null,
                            "args": null,
                            "concreteType": "GameRuntimeVersion",
                            "kind": "LinkedField",
                            "name": "previousVersion",
                            "plural": false,
                            "selections": (v7/*:: as any*/),
                            "storageKey": null
                          },
                          (v6/*:: as any*/)
                        ],
                        "storageKey": null
                      },
                      (v6/*:: as any*/)
                    ],
                    "storageKey": null
                  }
                ],
                "storageKey": null
              }
            ],
            "storageKey": "games(first:500)"
          },
          (v6/*:: as any*/)
        ],
        "storageKey": null
      }
    ]
  },
  "params": {
    "cacheID": "169b76dbd259ac615d2b712641a54087",
    "id": null,
    "metadata": {},
    "name": "cliGameRuntimesQuery",
    "operationKind": "query",
    "text": "query cliGameRuntimesQuery(\n  $token: String!\n) {\n  teamForToken(token: $token) {\n    slug\n    games(first: 500) {\n      edges {\n        node {\n          slug\n          runtime {\n            currentVersion {\n              assetsSha\n              id\n            }\n            nextVersion {\n              assetsSha\n              id\n            }\n            previousVersion {\n              assetsSha\n              id\n            }\n            id\n          }\n          id\n        }\n      }\n    }\n    id\n  }\n}\n"
  }
};
})();

(node as any).hash = "6467f74d92adb125c762ed24be7d4ac8";

export default node;
