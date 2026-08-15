import { encodedStringFromObject } from "../helpers/crypto";
import { TokenData, WindowClientRecord } from "../interfaces";
import { ClientManager } from "./window-manager";

/** Cache of compiled URL match patterns (null marks an invalid pattern) */
const patternCache = new Map<string, RegExp | null>();

/**
 * Compiles (and caches) a client URL pattern. Invalid patterns are cached as
 * null and treated as non-matching, so one bad pattern cannot break request
 * interception for every request.
 *
 * @param pattern - Regular expression pattern string from client registration
 * @returns The compiled RegExp, or null when the pattern is invalid
 */
function getCompiledPattern(pattern: string): RegExp | null {
  if (!patternCache.has(pattern)) {
    try {
      patternCache.set(pattern, new RegExp(pattern));
    } catch (error) {
      console.warn(`[SW] Ignoring invalid url-pattern "${pattern}":`, error);
      patternCache.set(pattern, null);
    }
  }
  return patternCache.get(pattern) ?? null;
}

/**
 * Finds the first registered client whose URL pattern matches the request URL
 *
 * @param clients - Registered client records for the current window
 * @param url - The URL of the intercepted request
 * @returns The matching client record, or undefined when nothing matches
 */
function findMatchingClient(
  clients: WindowClientRecord[],
  url: string
): WindowClientRecord | undefined {
  return clients.find((client) =>
    getCompiledPattern(client.urlPattern)?.test(url)
  );
}

/**
 * Performs a fetch with an optional Bearer token authorization header
 *
 * @param request - The original request
 * @param accessToken - Access token to attach (omitted when undefined)
 * @returns Promise resolving to the fetch Response
 */
function fetchWithToken(
  request: Request,
  accessToken?: string
): Promise<Response> {
  const headers = new Headers(request.headers);
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return fetch(new Request(request, { headers }));
}

/**
 * Intercepts and processes fetch requests in a service worker context, automatically adding
 * authentication headers and handling token refresh when needed.
 *
 * @param event - The FetchEvent from the service worker
 * @param windowManager - Instance of ClientManager for token and client management
 * @param windowId - Unique identifier for the current window/session
 * @returns Promise resolving to the Response (with authentication applied when configured)
 */
export async function doFetch(
  event: FetchEvent,
  windowManager: ClientManager,
  windowId: string
): Promise<Response> {
  // Find the registered client whose URL pattern matches the current request
  const clients = await windowManager.getClientsByWindowId(windowId);
  const matchedClient = findMatchingClient(clients, event.request.url);

  // No authentication configured for this request: pass through
  if (!matchedClient) {
    return fetch(event.request);
  }

  let tokenData = await windowManager.getTokens(matchedClient.clientId);

  // Proactively refresh an expired access token instead of waiting for a 401
  if (tokenData?.refresh_token && windowManager.isAccessTokenExpired(tokenData)) {
    tokenData = await refreshToken(windowManager, matchedClient).catch(
      () => null
    );
  }

  // Attempt the (authenticated) request
  const result = await fetchWithToken(event.request, tokenData?.access_token);

  // Anything other than a 401 needs no token handling
  if (result.status !== 401) {
    return result;
  }

  // Handle 401 Unauthorized response - token may be expired or revoked
  const refreshTokenData = await refreshToken(windowManager, matchedClient).catch(
    () => null
  );

  // If refresh failed, trigger re-authorization and return the original 401
  // response. The authorization flow performs a full page redirect, so
  // retrying the request now would fail anyway (and would send an invalid
  // "Bearer undefined" header).
  if (!refreshTokenData) {
    await windowManager
      .authorize(matchedClient)
      .catch((error) =>
        console.error("[SW] Failed to initiate authorization:", error)
      );
    return result;
  }

  // Retry request with refreshed token
  return fetchWithToken(event.request, refreshTokenData.access_token);
}


/**
 * Refreshes an expired access token using the refresh token.
 *
 * @param windowManager - Instance of ClientManager for token and client management
 * @param client - The client record containing authentication details
 * @returns Promise resolving to the new token data
 * @throws {Error} When no refresh token is available or token refresh fails
 */
async function refreshToken(
  windowManager: ClientManager,
  client: WindowClientRecord
): Promise<TokenData> {
  // Get the OAuth configuration for this client
  const clientConfig = await windowManager.getClientConfigFromClientRecord(client);
  const tokenEndpoint = clientConfig.token_endpoint;

  // Retrieve current token data to get the refresh token
  const currentTokenData = await windowManager.getTokens(client.clientId);

  if (!currentTokenData?.refresh_token) {
    throw new Error("No refresh token available");
  }

  // Prepare the token refresh request body
  const body = encodedStringFromObject({
    client_id: client.clientId,
    grant_type: "refresh_token",
    refresh_token: currentTokenData.refresh_token,
  });

  // Make the token refresh request to the OAuth server
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`);
  }

  // Parse and store the new token data
  const newTokenData = await response.json();
  await windowManager.setTokens(client.clientId, newTokenData);

  return newTokenData;
}
