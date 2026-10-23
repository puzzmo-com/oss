import React from "react"
import { Route } from "wouter"

import { WouterRoute } from "./types.js"

/** Creates React Route elements from a list of Wouter route configurations */
export const createRouteElements = (routes: WouterRoute[]): React.ReactElement[] =>
  routes.map((route, index) => <Route key={route.path + index} path={route.path} component={route.component} />)
