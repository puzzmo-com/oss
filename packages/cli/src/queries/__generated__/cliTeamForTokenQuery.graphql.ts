/**
 * @generated SignedSource<<41e09eab646bd6490af9a749ed04083c>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type cliTeamForTokenQuery$variables = {
  token: string;
};
export type cliTeamForTokenQuery$data = {
  readonly teamForToken: {
    readonly name: string;
  } | null | undefined;
};
export type cliTeamForTokenQuery = {
  response: cliTeamForTokenQuery$data;
  variables: cliTeamForTokenQuery$variables;
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
  "name": "name",
  "storageKey": null
};
return {
  "fragment": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "cliTeamForTokenQuery",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": "Team",
        "kind": "LinkedField",
        "name": "teamForToken",
        "plural": false,
        "selections": [
          (v2/*:: as any*/)
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
    "name": "cliTeamForTokenQuery",
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
            "args": null,
            "kind": "ScalarField",
            "name": "id",
            "storageKey": null
          }
        ],
        "storageKey": null
      }
    ]
  },
  "params": {
    "cacheID": "b4cfb3b8e689ae705b6bea83b73dee85",
    "id": null,
    "metadata": {},
    "name": "cliTeamForTokenQuery",
    "operationKind": "query",
    "text": "query cliTeamForTokenQuery(\n  $token: String!\n) {\n  teamForToken(token: $token) {\n    name\n    id\n  }\n}\n"
  }
};
})();

(node as any).hash = "d72ebb664e2ea3dc63ba397109b1e06e";

export default node;
