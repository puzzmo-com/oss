/**
 * @generated SignedSource<<ad1e4ca0faf950f8df336622238cda2f>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type cliRoundFixturesQuery$variables = {
  gameSlug: string;
  token: string;
};
export type cliRoundFixturesQuery$data = {
  readonly gameAchievementsDebug: {
    readonly members: ReadonlyArray<{
      readonly rounds: ReadonlyArray<{
        readonly at: number;
        readonly fixture: any | null | undefined;
        readonly hasLog: boolean;
        readonly outcome: string;
        readonly verified: boolean;
      }>;
      readonly username: string;
    }>;
  } | null | undefined;
};
export type cliRoundFixturesQuery = {
  response: cliRoundFixturesQuery$data;
  variables: cliRoundFixturesQuery$variables;
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
  "name": "token"
},
v2 = [
  {
    "kind": "Variable",
    "name": "gameSlug",
    "variableName": "gameSlug"
  },
  {
    "kind": "Variable",
    "name": "token",
    "variableName": "token"
  }
],
v3 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "username",
  "storageKey": null
},
v4 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "at",
  "storageKey": null
},
v5 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "outcome",
  "storageKey": null
},
v6 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "verified",
  "storageKey": null
},
v7 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "hasLog",
  "storageKey": null
},
v8 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "fixture",
  "storageKey": null
};
return {
  "fragment": {
    "argumentDefinitions": [
      (v0/*:: as any*/),
      (v1/*:: as any*/)
    ],
    "kind": "Fragment",
    "metadata": null,
    "name": "cliRoundFixturesQuery",
    "selections": [
      {
        "alias": null,
        "args": (v2/*:: as any*/),
        "concreteType": "AchievementsDebug",
        "kind": "LinkedField",
        "name": "gameAchievementsDebug",
        "plural": false,
        "selections": [
          {
            "alias": null,
            "args": null,
            "concreteType": "AchievementMemberDebug",
            "kind": "LinkedField",
            "name": "members",
            "plural": true,
            "selections": [
              (v3/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "concreteType": "AchievementRoundTrace",
                "kind": "LinkedField",
                "name": "rounds",
                "plural": true,
                "selections": [
                  (v4/*:: as any*/),
                  (v5/*:: as any*/),
                  (v6/*:: as any*/),
                  (v7/*:: as any*/),
                  (v8/*:: as any*/)
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
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [
      (v1/*:: as any*/),
      (v0/*:: as any*/)
    ],
    "kind": "Operation",
    "name": "cliRoundFixturesQuery",
    "selections": [
      {
        "alias": null,
        "args": (v2/*:: as any*/),
        "concreteType": "AchievementsDebug",
        "kind": "LinkedField",
        "name": "gameAchievementsDebug",
        "plural": false,
        "selections": [
          {
            "alias": null,
            "args": null,
            "concreteType": "AchievementMemberDebug",
            "kind": "LinkedField",
            "name": "members",
            "plural": true,
            "selections": [
              (v3/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "concreteType": "AchievementRoundTrace",
                "kind": "LinkedField",
                "name": "rounds",
                "plural": true,
                "selections": [
                  (v4/*:: as any*/),
                  (v5/*:: as any*/),
                  (v6/*:: as any*/),
                  (v7/*:: as any*/),
                  (v8/*:: as any*/),
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
            ],
            "storageKey": null
          }
        ],
        "storageKey": null
      }
    ]
  },
  "params": {
    "cacheID": "cb33ad9d9ddc13040962cb0b33f440bc",
    "id": null,
    "metadata": {},
    "name": "cliRoundFixturesQuery",
    "operationKind": "query",
    "text": "query cliRoundFixturesQuery(\n  $token: String!\n  $gameSlug: String!\n) {\n  gameAchievementsDebug(token: $token, gameSlug: $gameSlug) {\n    members {\n      username\n      rounds {\n        at\n        outcome\n        verified\n        hasLog\n        fixture\n        id\n      }\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "8e55ffc09d8cf780e1e136991d939d8f";

export default node;
