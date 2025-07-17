import { encodedStringFromObject } from "../helpers/crypto";
import { TokenData, WindowClientRecord } from "../interfaces";
import { ClientManager } from "./window-manager";

/**
 * Intercepts and processes fetch requests in a service worker context, automatically adding
 * authentication headers and handling token refresh when needed.
 * 
 * @param event - The FetchEvent from the service worker
 * @param windowManager - Instance of WindowManager for token and client management
 * @param windowId - Unique identifier for the current window/session
 * @returns Promise resolving to the modified Response with authentication headers
 */
export async function doFetch(
  event: FetchEvent,
  windowManager: ClientManager,
  windowId: string
): Promise<Response> {

  // Get all registered clients for this window
  const clients = await windowManager.getClientsByWindowId(windowId);
  const patterns = clients.map((client) => client.urlPattern);

  // Find clients whose URL patterns match the current request
  const matchedClients: WindowClientRecord[] = [];
  patterns.forEach((pattern) => {
    const regex = new RegExp(pattern);
    const isMatch = regex.test(event.request.url);
    if (isMatch) {
      const foundClient = clients.find((client) => client.urlPattern === pattern);
      if (foundClient) {
        matchedClients.push(foundClient);
      }
    }
  });

  // If we found a matching client, add authentication headers
  if (matchedClients && matchedClients[0]) {

    // Retrieve current access token for the matched client
    const tokenData = await windowManager.getTokens(
      matchedClients[0].clientId
    );
    
    // Add Authorization header with Bearer token if available
    let headers = new Headers(event.request.headers);
    tokenData && headers.set('Authorization', `Bearer ${tokenData.access_token}`);
    let modifiedRequest = new Request(event.request, {
      headers: headers,
    });
    
    // Attempt the authenticated request
    const result = await  fetch(modifiedRequest);
    
    // Handle 401 Unauthorized response - token may be expired
    if (result.status === 401) {
      const refreshTokenData = await refreshToken(windowManager, matchedClients[0]).catch((e) => e);
      
      // If refresh failed, trigger re-authorization
      if (refreshTokenData instanceof Error) {
         await windowManager.authorize(matchedClients[0]);
      }
      
      // Retry request with refreshed token
      headers = new Headers(event.request.headers);
      refreshTokenData && headers.set('Authorization', `Bearer ${refreshTokenData.access_token}`);
      modifiedRequest = new Request(event.request, {
        headers: headers,
      });
      return fetch(modifiedRequest);
    }
    return result;
  }

  // If no matching client is found, fallback to the default fetch behavior
  return fetch(event.request);
}


/**
 * Refreshes an expired access token using the refresh token.
 * 
 * @param windowManager - Instance of WindowManager for token and client management
 * @param client - The client record containing authentication details
 * @returns Promise resolving to the new token data
 * @throws {Error} When no refresh token is available or token refresh fails
 */
async function refreshToken(windowManager: ClientManager, client: WindowClientRecord){
  // Get the OAuth configuration for this client
  const clientConfig = await windowManager.getClientConfigFromClientRecord(client);
  const tokenEndpoint = clientConfig.token_endpoint;
  
  // Retrieve current token data to get the refresh token
  const currentTokenData = await windowManager.getTokens(client.clientId);
  
  if (!currentTokenData?.refresh_token) {
    return Promise.reject(new Error("No refresh token available"));
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
    return Promise.reject(new Error(`Token refresh failed: ${response.status} ${response.statusText}`));
  }
  
  // Parse and store the new token data
  const newTokenData = await response.json();
  await windowManager.setTokens(client.clientId, newTokenData);
  
  return newTokenData;
}

