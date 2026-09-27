/**
 * @generated SignedSource<<76fc8a9b6e4d8ebe2c47a8b32617c0be>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type cliGamesForAccessTokenQuery$variables = {
  token: string;
};
export type cliGamesForAccessTokenQuery$data = {
  readonly gamesForAccessToken: ReadonlyArray<{
    readonly slug: string;
  }> | null | undefined;
};
export type cliGamesForAccessTokenQuery = {
  response: cliGamesForAccessTokenQuery$data;
  variables: cliGamesForAccessTokenQuery$variables;
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
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "token",
        "variableName": "token"
      }
    ],
    "concreteType": "AccessibleGame",
    "kind": "LinkedField",
    "name": "gamesForAccessToken",
    "plural": true,
    "selections": [
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "slug",
        "storageKey": null
      }
    ],
    "storageKey": null
  }
];
return {
  "fragment": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "cliGamesForAccessTokenQuery",
    "selections": (v1/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "cliGamesForAccessTokenQuery",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "95e52459ee4e3b5b63aebf0a956d84b9",
    "id": null,
    "metadata": {},
    "name": "cliGamesForAccessTokenQuery",
    "operationKind": "query",
    "text": "query cliGamesForAccessTokenQuery(\n  $token: String!\n) {\n  gamesForAccessToken(token: $token) {\n    slug\n  }\n}\n"
  }
};
})();

(node as any).hash = "5e25f82f0177e712ee4d7e9e95245d28";

export default node;
