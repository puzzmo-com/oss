import type { SimulatorContext, SimulatorView } from "../types"

// API mode storage
const API_MODE_KEY = "puzzmo_sim_api_mode"
const LOCAL_DEV_URL = "http://localhost:8911"
const PROD_URL = "https://api.puzzmo.com"

type ApiMode = "prod" | "dev"

const getApiMode = (): ApiMode => {
  const stored = localStorage.getItem(API_MODE_KEY)
  return stored === "dev" ? "dev" : "prod"
}

const setApiMode = (mode: ApiMode) => {
  localStorage.setItem(API_MODE_KEY, mode)
}

// Check if local dev server is available
let localDevAvailable: boolean | null = null
const checkLocalDevAvailable = async (): Promise<boolean> => {
  if (localDevAvailable !== null) return localDevAvailable

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 1000)

    const response = await fetch(`${LOCAL_DEV_URL}/healthz`, {
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    localDevAvailable = response.ok
    return localDevAvailable
  } catch {
    localDevAvailable = false
    return false
  }
}

// OAuth configuration
const getOAuthConfig = () => {
  const mode = getApiMode()
  const apiURL = mode === "dev" ? LOCAL_DEV_URL : PROD_URL
  const clientID = "protosdk:oauthclient"
  // Use a fixed callback path that's registered with the OAuth server
  const redirectUri = `${window.location.origin}/oauth/callback`

  return { apiURL, clientID, redirectUri }
}

// Generate CSRF state token
const generateState = (): string => {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

// Token storage
const TOKEN_KEY = "puzzmo_sim_oauth_token"
const REFRESH_TOKEN_KEY = "puzzmo_sim_oauth_refresh_token"

const storeAccessToken = (token: string) => localStorage.setItem(TOKEN_KEY, token)
const storeRefreshToken = (token: string) => localStorage.setItem(REFRESH_TOKEN_KEY, token)
const getAccessToken = (): string | null => {
  const token = localStorage.getItem(TOKEN_KEY)
  console.log("[AuthView] getAccessToken:", { TOKEN_KEY, token: token ? `${token.substring(0, 20)}...` : null })
  return token
}
const getRefreshToken = (): string | null => localStorage.getItem(REFRESH_TOKEN_KEY)
const clearTokens = () => {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

// Initiate OAuth login flow
const initiateOAuthLogin = () => {
  const config = getOAuthConfig()
  const state = generateState()

  sessionStorage.setItem("oauth_state", state)
  // Store the current URL to return to after OAuth callback
  sessionStorage.setItem("oauth_return_url", window.location.href)

  const authURL = new URL(`${config.apiURL}/oauth/auth`)
  authURL.searchParams.set("client_id", config.clientID)
  authURL.searchParams.set("response_type", "code")
  authURL.searchParams.set("redirect_uri", config.redirectUri)
  authURL.searchParams.set("state", state)

  window.location.href = authURL.toString()
}

// Exchange authorization code for access token
type TokenResponse = {
  // Standard OAuth snake_case fields
  access_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
  refresh_token?: string
  // Server returns camelCase
  accessToken?: string
  refreshToken?: string
}

// Check if token is expired or about to expire (within 5 minutes)
const isTokenExpired = (token: string): boolean => {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return true
    const payload = JSON.parse(atob(parts[1]))
    const exp = payload.exp
    if (!exp) return true
    // Consider expired if less than 5 minutes remaining
    return Date.now() >= (exp * 1000) - 5 * 60 * 1000
  } catch {
    return true
  }
}

// Refresh the access token using the refresh token
const refreshAccessToken = async (): Promise<boolean> => {
  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    console.log("[AuthView] No refresh token available")
    return false
  }

  const config = getOAuthConfig()

  try {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.clientID,
    })

    const response = await fetch(`${config.apiURL}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    })

    if (!response.ok) {
      console.error("[AuthView] Failed to refresh token:", response.statusText)
      return false
    }

    const tokenResponse: TokenResponse = await response.json()
    const accessToken = tokenResponse.access_token || tokenResponse.accessToken
    if (!accessToken) {
      console.error("[AuthView] No access token in refresh response")
      return false
    }

    storeAccessToken(accessToken)
    // Update refresh token if a new one was provided
    const newRefreshToken = tokenResponse.refresh_token || tokenResponse.refreshToken
    if (newRefreshToken) {
      storeRefreshToken(newRefreshToken)
    }

    console.log("[AuthView] Successfully refreshed access token")
    return true
  } catch (error) {
    console.error("[AuthView] Error refreshing token:", error)
    return false
  }
}

const exchangeCodeForToken = async (code: string, state: string): Promise<TokenResponse | null> => {
  const config = getOAuthConfig()
  const storedState = sessionStorage.getItem("oauth_state")

  if (!storedState || storedState !== state) {
    console.error("OAuth state mismatch - possible CSRF attack")
    return null
  }

  sessionStorage.removeItem("oauth_state")

  try {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config.clientID,
      redirect_uri: config.redirectUri,
    })

    const response = await fetch(`${config.apiURL}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    })

    if (!response.ok) {
      console.error("Failed to exchange code for token:", response.statusText)
      return null
    }

    return await response.json()
  } catch (error) {
    console.error("Error exchanging code for token:", error)
    return null
  }
}

// Make authenticated API request with automatic token refresh
const makeAuthenticatedRequest = async (query: string, variables: Record<string, unknown> = {}) => {
  const config = getOAuthConfig()
  let token = getAccessToken()

  if (!token) {
    throw new Error("Not authenticated")
  }

  // Check if token is expired and try to refresh
  if (isTokenExpired(token)) {
    console.log("[AuthView] Access token expired, attempting refresh...")
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      token = getAccessToken()
      if (!token) {
        throw new Error("Token refresh succeeded but no token available")
      }
    } else {
      // Refresh failed, clear tokens and require re-login
      clearTokens()
      throw new Error("Session expired. Please log in again.")
    }
  }

  const response = await fetch(`${config.apiURL}/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "auth-provider": "custom",
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    throw new Error(`API request failed: ${response.statusText}`)
  }

  return response.json()
}

// Decode JWT to get user info (basic decode, no verification)
const decodeJWT = (token: string): { sub?: string; exp?: number; userID?: string } | null => {
  try {
    console.log("[AuthView] decodeJWT input:", token)
    const parts = token.split(".")
    console.log("[AuthView] JWT parts:", parts.length)
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1]))
    console.log("[AuthView] JWT payload:", payload)
    return payload
  } catch (e) {
    console.error("[AuthView] decodeJWT error:", e)
    return null
  }
}

export function createAuthView(): SimulatorView {
  // Track if we've checked for local dev availability
  let devCheckDone = false

  return {
    id: "auth",
    label: "Auth",

    render() {
      const token = getAccessToken()
      const isAuthenticated = !!token
      const currentMode = getApiMode()
      const apiURL = currentMode === "dev" ? LOCAL_DEV_URL : PROD_URL

      // Dev toggle button - hidden by default, shown via JS if local dev is available
      const devToggle = `<button class="simulator-btn tiny" id="auth-dev-toggle" style="display: none;">${currentMode === "dev" ? "Using Dev" : "Dev"}</button>`

      if (isAuthenticated) {
        const decoded = decodeJWT(token)
        const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000).toLocaleString() : "Unknown"
        const hasRefreshToken = !!getRefreshToken()
        const refreshDecoded = hasRefreshToken ? decodeJWT(getRefreshToken()!) : null
        const refreshExpiresAt = refreshDecoded?.exp ? new Date(refreshDecoded.exp * 1000).toLocaleString() : null
        console.log({ decoded })

        return `
          <div class="simulator-section">
            <div class="simulator-section-title auth-title-row">
              <span>Puzzmo Authentication</span>
              ${devToggle}
              <button class="simulator-btn danger tiny" id="auth-logout">Logout</button>
            </div>
            <div id="auth-status" class="auth-status authenticated">
              <span class="indicator ready"></span>
              <span>Authenticated</span>
            </div>
            <div id="auth-user-info" class="auth-user-info">
              <div>User ID: <code>${decoded?.userID || decoded?.sub || "Unknown"}</code></div>
              <div>API: <code>${apiURL}</code></div>
              <div>Access expires: <code>${expiresAt}</code></div>
              ${hasRefreshToken ? `<div>Refresh expires: <code>${refreshExpiresAt || "Unknown"}</code></div>` : '<div class="auth-warning">No refresh token</div>'}
            </div>
            ${hasRefreshToken ? '<button class="simulator-btn secondary tiny" id="auth-refresh">Refresh Now</button>' : ""}
          </div>
          <div class="simulator-section">
            <div class="simulator-section-title">Test API Request</div>
            <div class="simulator-row">
              <button class="simulator-btn primary" id="auth-test-api">Fetch Current User</button>
            </div>
            <div id="auth-api-result" class="auth-api-result"></div>
          </div>
        `
      }

      return `
        <div class="simulator-section">
          <div class="simulator-section-title auth-title-row">
            <span>Puzzmo Authentication</span>
            ${devToggle}
          </div>
          <div id="auth-status" class="auth-status">
            <span class="indicator waiting"></span>
            <span>Not authenticated</span>
          </div>
          <p class="auth-description">
            Login with your Puzzmo account to make authenticated API requests.
            ${currentMode === "dev" ? `<br><strong>Using local dev server:</strong> ${LOCAL_DEV_URL}` : ""}
          </p>
          <div class="simulator-row">
            <button class="simulator-btn primary" id="auth-login">Login with Puzzmo</button>
          </div>
          <div id="auth-error" class="auth-error"></div>
        </div>
      `
    },

    bind(ctx: SimulatorContext) {
      const loginBtn = ctx.getElement<HTMLButtonElement>("#auth-login")
      const logoutBtn = ctx.getElement<HTMLButtonElement>("#auth-logout")
      const refreshBtn = ctx.getElement<HTMLButtonElement>("#auth-refresh")
      const testApiBtn = ctx.getElement<HTMLButtonElement>("#auth-test-api")
      const apiResult = ctx.getElement<HTMLElement>("#auth-api-result")
      const devToggleBtn = ctx.getElement<HTMLButtonElement>("#auth-dev-toggle")

      // Check for local dev availability and show toggle if available
      if (!devCheckDone) {
        devCheckDone = true
        checkLocalDevAvailable().then((available) => {
          if (available && devToggleBtn) {
            devToggleBtn.style.display = ""
            // Style based on current mode
            if (getApiMode() === "dev") {
              devToggleBtn.classList.add("active")
            }
          }
        })
      } else if (localDevAvailable && devToggleBtn) {
        // Already checked, just show the button
        devToggleBtn.style.display = ""
        if (getApiMode() === "dev") {
          devToggleBtn.classList.add("active")
        }
      }

      // Dev toggle click handler
      devToggleBtn?.addEventListener("click", () => {
        const currentMode = getApiMode()
        const newMode = currentMode === "dev" ? "prod" : "dev"
        setApiMode(newMode)
        // Clear tokens when switching modes since they're for different servers
        clearTokens()
        window.location.reload()
      })

      loginBtn?.addEventListener("click", () => {
        initiateOAuthLogin()
      })

      logoutBtn?.addEventListener("click", () => {
        clearTokens()
        window.location.reload()
      })

      refreshBtn?.addEventListener("click", async () => {
        refreshBtn.disabled = true
        refreshBtn.textContent = "Refreshing..."
        const success = await refreshAccessToken()
        if (success) {
          window.location.reload()
        } else {
          refreshBtn.textContent = "Refresh Failed"
          refreshBtn.disabled = false
        }
      })

      testApiBtn?.addEventListener("click", async () => {
        if (!apiResult) return

        apiResult.innerHTML = '<div class="loading">Loading...</div>'

        try {
          const result = await makeAuthenticatedRequest(`
            query {
              currentUser {
                id
                username
                usernameID
                name
              }
            }
          `)

          if (result.errors) {
            apiResult.innerHTML = `<div class="error">Error: ${result.errors[0]?.message || "Unknown error"}</div>`
          } else {
            apiResult.innerHTML = `<pre>${JSON.stringify(result.data, null, 2)}</pre>`
          }
        } catch (error) {
          apiResult.innerHTML = `<div class="error">Error: ${error instanceof Error ? error.message : "Unknown error"}</div>`
        }
      })
    },

    async onActivate(ctx: SimulatorContext) {
      // Check for OAuth callback parameters
      const urlParams = new URLSearchParams(window.location.search)
      const code = urlParams.get("code")
      const state = urlParams.get("state")
      const error = urlParams.get("error")

      if (error) {
        const errorEl = ctx.getElement<HTMLElement>("#auth-error")
        if (errorEl) {
          errorEl.innerHTML = `<div class="error">OAuth error: ${error}</div>`
        }
        // Clean up URL
        window.history.replaceState({}, "", window.location.pathname)
        return
      }

      if (code && state) {
        const statusEl = ctx.getElement<HTMLElement>("#auth-status")
        if (statusEl) {
          statusEl.innerHTML = '<span class="indicator waiting"></span><span>Exchanging code...</span>'
        }

        const tokenResponse = await exchangeCodeForToken(code, state)

        // Clean up URL
        window.history.replaceState({}, "", window.location.pathname)

        if (tokenResponse) {
          const accessToken = tokenResponse.access_token || tokenResponse.accessToken
          if (accessToken) {
            storeAccessToken(accessToken)
            const refreshToken = tokenResponse.refresh_token || tokenResponse.refreshToken
            if (refreshToken) {
              storeRefreshToken(refreshToken)
            }
          }
          window.location.reload()
        } else {
          const errorEl = ctx.getElement<HTMLElement>("#auth-error")
          if (errorEl) {
            errorEl.innerHTML = '<div class="error">Failed to exchange code for token</div>'
          }
        }
      }
    },
  }
}
