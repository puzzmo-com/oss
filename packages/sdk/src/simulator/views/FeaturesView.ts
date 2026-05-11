import type { SimulatorContext, SimulatorView } from "../types"

// API mode storage (shared with AuthView)
const apiModeKey = "puzzmo_sim_api_mode"
const localDevUrl = "http://localhost:8911"
const prodUrl = "https://api.puzzmo.com"
const tokenKey = "puzzmo_sim_oauth_token"
const refreshTokenKey = "puzzmo_sim_oauth_refresh_token"

type ApiMode = "prod" | "dev"

const getApiMode = (): ApiMode => {
  const stored = localStorage.getItem(apiModeKey)
  return stored === "dev" ? "dev" : "prod"
}

const getAccessToken = (): string | null => localStorage.getItem(tokenKey)
const getRefreshToken = (): string | null => localStorage.getItem(refreshTokenKey)

const storeAccessToken = (token: string) => localStorage.setItem(tokenKey, token)
const storeRefreshToken = (token: string) => localStorage.setItem(refreshTokenKey, token)

const clearTokens = () => {
  localStorage.removeItem(tokenKey)
  localStorage.removeItem(refreshTokenKey)
}

// Check if token is expired or about to expire (within 5 minutes)
const isTokenExpired = (token: string): boolean => {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return true
    const payload = JSON.parse(atob(parts[1]))
    const exp = payload.exp
    if (!exp) return true
    return Date.now() >= exp * 1000 - 5 * 60 * 1000
  } catch {
    return true
  }
}

// Refresh the access token using the refresh token
const refreshAccessToken = async (): Promise<boolean> => {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false

  const mode = getApiMode()
  const apiURL = mode === "dev" ? localDevUrl : prodUrl

  try {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: "protosdk:oauthclient",
    })

    const response = await fetch(`${apiURL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    })

    if (!response.ok) return false

    const tokenResponse = await response.json()
    const accessToken = tokenResponse.access_token || tokenResponse.accessToken
    if (!accessToken) return false

    storeAccessToken(accessToken)
    const newRefreshToken = tokenResponse.refresh_token || tokenResponse.refreshToken
    if (newRefreshToken) storeRefreshToken(newRefreshToken)

    return true
  } catch {
    return false
  }
}

// Make authenticated API request with automatic token refresh
const makeAuthenticatedRequest = async (query: string, variables: Record<string, unknown> = {}) => {
  const mode = getApiMode()
  const apiURL = mode === "dev" ? localDevUrl : prodUrl
  let token = getAccessToken()

  if (!token) throw new Error("Not authenticated")

  if (isTokenExpired(token)) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      token = getAccessToken()
      if (!token) throw new Error("Token refresh succeeded but no token available")
    } else {
      clearTokens()
      throw new Error("Session expired. Please log in again.")
    }
  }

  const response = await fetch(`${apiURL}/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "auth-provider": "custom",
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) throw new Error(`API request failed: ${response.statusText}`)
  return response.json()
}

// Types for game features
type GameFeature = {
  featureID: number
  title: string
  isEnabled: boolean
}

type GameFeatureGroup = {
  slug: string
  title: string
  features: GameFeature[]
}

type GameData = {
  id: string
  slug: string
  displayName: string
  featuresArr: number[]
  gameFeatures: GameFeatureGroup[]
}

// GraphQL queries
const gameFeaturesQuery = `
  query GameFeaturesQuery($slug: ID!) {
    game(id: $slug) {
      id
      slug
      displayName
      featuresArr
      gameFeatures {
        slug
        title
        features {
          featureID
          title
          isEnabled
        }
      }
    }
  }
`

const toggleFeatureMutation = `
  mutation ToggleFeatureMutation($gameSlug: ID!, $input: UpdateGameInput!) {
    updateGame(id: $gameSlug, input: $input) {
      id
      featuresArr
      gameFeatures {
        slug
        title
        features {
          featureID
          title
          isEnabled
        }
      }
    }
  }
`

// Helper to toggle a feature in the array
const toggleFeatureInArr = (featuresArr: number[], featureID: number): number[] => {
  const bitIndex = featureID - 1
  const arrayIndex = Math.floor(bitIndex / 31)
  const bitPosition = bitIndex % 31

  const result = [...featuresArr]
  while (result.length <= arrayIndex) result.push(0)
  result[arrayIndex] = result[arrayIndex] ^ (1 << bitPosition)
  return result
}

// Check if user is authenticated
export const isAuthenticated = (): boolean => {
  const token = getAccessToken()
  return !!token
}

export function createFeaturesView(): SimulatorView {
  let gameData: GameData | null = null
  let loading = false
  let error: string | null = null

  const fetchGameFeatures = async (gameSlug: string): Promise<void> => {
    loading = true
    error = null

    try {
      const result = await makeAuthenticatedRequest(gameFeaturesQuery, { slug: gameSlug })

      if (result.errors) {
        error = result.errors[0]?.message || "Unknown error"
        gameData = null
      } else if (result.data?.game) {
        gameData = result.data.game
      } else {
        error = "Game not found"
        gameData = null
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "Unknown error"
      gameData = null
    } finally {
      loading = false
    }
  }

  const toggleFeature = async (featureID: number): Promise<void> => {
    if (!gameData) return

    const newFeaturesArr = toggleFeatureInArr(gameData.featuresArr, featureID)

    try {
      const result = await makeAuthenticatedRequest(toggleFeatureMutation, {
        gameSlug: gameData.slug,
        input: { featuresArr: newFeaturesArr },
      })

      if (result.errors) {
        console.error("Failed to toggle feature:", result.errors[0]?.message)
      } else if (result.data?.updateGame) {
        // Update local state with new data
        gameData = {
          ...gameData,
          featuresArr: result.data.updateGame.featuresArr,
          gameFeatures: result.data.updateGame.gameFeatures,
        }
      }
    } catch (e) {
      console.error("Failed to toggle feature:", e)
    }
  }

  const renderFeatures = (): string => {
    if (loading) {
      return '<div class="features-loading">Loading features...</div>'
    }

    if (error) {
      return `<div class="features-error">${error}</div>`
    }

    if (!gameData) {
      return '<div class="features-empty">Enter your game slug above to load features</div>'
    }

    const groupsHtml = gameData.gameFeatures
      .map((group) => {
        const featuresHtml = group.features
          .map((f) => {
            const statusClass = f.isEnabled ? "enabled" : "disabled"
            const statusIcon = f.isEnabled ? "✓" : "✗"
            return `
              <div class="feature-item ${statusClass}" data-feature-id="${f.featureID}">
                <span class="feature-status">${statusIcon}</span>
                <span class="feature-title">${f.title}</span>
              </div>
            `
          })
          .join("")

        return `
          <div class="feature-group">
            <div class="feature-group-title">${group.title}</div>
            <div class="feature-group-items">${featuresHtml}</div>
          </div>
        `
      })
      .join("")

    return `
      <div class="features-game-name">${gameData.displayName}</div>
      ${groupsHtml}
    `
  }

  return {
    id: "features",
    label: "Features",

    render() {
      if (!isAuthenticated()) {
        return `
          <div class="features-view-container">
            <div class="simulator-section">
              <div class="simulator-section-title">Game Features</div>
              <div class="features-auth-required">
                <p>You must be logged in to view and edit game features.</p>
                <p>Go to the <strong>Auth</strong> tab to log in with your Puzzmo account.</p>
              </div>
            </div>
          </div>
        `
      }

      return `
        <div class="features-view-container">
          <div class="simulator-section">
            <div class="simulator-section-title">Game Features</div>
            <div class="features-slug-input">
              <input type="text" class="simulator-input" id="features-game-slug" placeholder="Game slug (e.g. crossword)" />
              <button class="simulator-btn primary" id="features-load-btn">Load</button>
            </div>
          </div>
          <div class="simulator-divider"></div>
          <div id="features-content" class="features-content">
            ${renderFeatures()}
          </div>
        </div>
      `
    },

    bind(ctx: SimulatorContext) {
      const loadBtn = ctx.getElement<HTMLButtonElement>("#features-load-btn")
      const slugInput = ctx.getElement<HTMLInputElement>("#features-game-slug")
      const contentEl = ctx.getElement<HTMLElement>("#features-content")

      const updateContent = () => {
        if (contentEl) {
          contentEl.innerHTML = renderFeatures()
          bindFeatureItems()
        }
      }

      const bindFeatureItems = () => {
        const featureItems = ctx.getElement<HTMLElement>("#features-content")?.querySelectorAll(".feature-item")
        featureItems?.forEach((item) => {
          item.addEventListener("click", async () => {
            const featureId = parseInt(item.getAttribute("data-feature-id") || "0")
            if (featureId > 0) {
              item.classList.add("updating")
              await toggleFeature(featureId)
              updateContent()
            }
          })
        })
      }

      const loadFeatures = async (slug: string) => {
        if (!slug) return

        if (loadBtn) {
          loadBtn.disabled = true
          loadBtn.textContent = "Loading..."
        }

        await fetchGameFeatures(slug)
        updateContent()

        if (loadBtn) {
          loadBtn.disabled = false
          loadBtn.textContent = "Load"
        }
      }

      loadBtn?.addEventListener("click", async () => {
        const slug = slugInput?.value.trim()
        if (slug) await loadFeatures(slug)
      })

      slugInput?.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          loadBtn?.click()
        }
      })

      // Pre-fill slug from context and auto-load if authenticated
      console.log("[FeaturesView] bind called, ctx.gameSlug:", ctx.gameSlug, "slugInput:", slugInput)
      if (ctx.gameSlug && slugInput) {
        slugInput.value = ctx.gameSlug
        // Auto-load features if authenticated and we have a slug
        if (isAuthenticated() && !gameData) {
          loadFeatures(ctx.gameSlug)
        }
      }

      // Bind initial feature items if any
      bindFeatureItems()
    },

    onActivate(ctx: SimulatorContext) {
      // Re-render entire view when tab becomes active to handle auth status changes
      const tabContainer = ctx.getElement<HTMLElement>("#simulator-tab-features")
      if (tabContainer) {
        tabContainer.innerHTML = this.render()
        this.bind(ctx)
      }
    },
  }
}
