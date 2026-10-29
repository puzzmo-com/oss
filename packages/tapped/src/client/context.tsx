import React, { createContext, useContext } from "react"
import { OperationType } from "relay-runtime"

import { debugLog } from "../index.js"
import type { PreloadedData } from "../relay/types.js"

interface SSRContextType {
  loaderData: PreloadedData<OperationType> | null
}

const SSRContext = createContext<SSRContextType | null>(null)

type WouterLoaderProviderProps = {
  children: React.ReactNode
  loaderData: PreloadedData<OperationType> | null
}

/** Provider component that supplies SSR loader data to child components */
export const WouterLoaderProvider = (props: WouterLoaderProviderProps) => {
  const { children, loaderData } = props
  return <SSRContext.Provider value={{ loaderData }}>{children}</SSRContext.Provider>
}

/** Hook to access SSR loader data from context or window object (client-side hydration) */
export const useSSRData = <TQuery extends OperationType = OperationType>(): PreloadedData<TQuery> | null => {
  const context = useContext(SSRContext)

  if (!context?.loaderData && typeof window !== "undefined") {
    // The server serializes only `variables` — the query and its compiled artifact are bundle-side
    const windowLoaderData = (window as any).__LOADER_DATA as PreloadedData<TQuery> | null | undefined
    debugLog("Using window.__LOADER_DATA:", windowLoaderData)
    if (windowLoaderData) {
      return windowLoaderData
    }
  }

  if (!context) {
    throw new Error("useSSRData must be used within a WouterLoaderProvider")
  }

  debugLog("Using context loader data:", context.loaderData)
  return context.loaderData as PreloadedData<TQuery> | null
}
