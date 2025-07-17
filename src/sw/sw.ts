import { encodedStringFromObject } from "../helpers/crypto";
import { RegisterClientRequestData } from "../interfaces";
import { doFetch } from "./fetch";
import { getOpenIdConfiguration } from "./openid-configurations";
import { ClientManager } from "./window-manager";

/**
 * Validates that a message comes from a trusted source
 * @param event - The message event to validate
 * @returns true if the message is from a trusted source
 */
function validateMessageSource(event: ExtendableMessageEvent): boolean {
  const windowClient = event.source as WindowClient;
  if (!windowClient || !windowClient.url) {
    return false;
  }

  // Only allow messages from same origin
  const clientOrigin = new URL(windowClient.url).origin;
  const serviceWorkerOrigin = new URL(self.location.href).origin;

  return clientOrigin === serviceWorkerOrigin;
}

/**
 * Extended ServiceWorkerGlobalScope interface for authentication service worker.
 * Adds a windowManager property to manage client windows and authentication state.
 */
export interface AuthServiceWorker extends ServiceWorkerGlobalScope {
  /** Window manager instance for handling client registration and token management */
  windowManager: ClientManager;
}

declare let self: AuthServiceWorker;

// Initialize the window manager singleton instance
self.windowManager = ClientManager.getInstance(self);

/**
 * Handles fetch events by intercepting network requests and processing them
 * through the authentication system when needed.
 *
 * @param event - The fetch event containing request details
 */

self.addEventListener("fetch", (event: FetchEvent) => {
  if (event.request.method === "GET") {
    if (
      event.request.mode === "navigate" &&
      event.request.headers.get("accept")?.includes("text/html")
    ) {
      console.log("Navigating", event.request);
    }
  }
  const windowId = event.clientId;
  event.respondWith(doFetch(event, self.windowManager, windowId));
});

/**
 * Handles the service worker install event.
 * Immediately activates the service worker without waiting for existing clients to close.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

/**
 * Handles the service worker activate event.
 * Claims control of all existing clients immediately upon activation.
 */
self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Handles messages from client windows for authentication operations.
 * Supports client registration and OAuth authorization callback processing.
 *
 * Message types handled:
 * - "register-client": Registers a new OAuth client with the service worker
 * - "authorize-callback": Processes OAuth authorization code callback
 *
 * @param event - The message event containing the operation type and data
 */
self.addEventListener("message", async (event: ExtendableMessageEvent) => {
  const windowClient = event.source as WindowClient;
  if (!windowClient) {
    return;
  }

  // Validate message source for security
  if (!validateMessageSource(event)) {
    console.warn(
      "[SW] Rejected message from untrusted source:",
      windowClient.url
    );
    return;
  }

  switch (event.data.type) {
    case "register-client":
      /**
       * Handles client registration by:
       * 1. Retrieving OpenID configuration from discovery URL
       * 2. Registering the client with the window manager
       * 3. Sending success/error response to the client
       */
      const data = event.data as RegisterClientRequestData;

      const config = await getOpenIdConfiguration(
        self,
        event.data.discoveryUrl
      ).catch((e) => e);

      const postErrorMessage = (errorMessage: string) => {
        windowClient.postMessage({
          type: "client-registration-error",
          clientId: event.data.clientId,
          error: errorMessage,
        });
      };

      if (config instanceof Error) {
        console.error(
          `[Service Worker] Error retrieving OpenID configuration for ${event.data.discoveryUrl}:`,
          config
        );
        postErrorMessage(
          `Failed to retrieve OpenID configuration: ${config.message}`
        );
        return;
      }

      const registerClientResult = await self.windowManager
        .registerClient({
          windowId: windowClient.id,
          ...data,
        })
        .catch((e) => e);

      if (registerClientResult instanceof Error) {
        postErrorMessage(
          `Failed to register client: ${registerClientResult.message}`
        );
        return;
      }

      windowClient.postMessage({
        type: "client-registered",
        clientId: event.data.clientId,
        clientType: event.data.clientType,
      });

      break;

    case "authorize-callback":
      /**
       * Handles OAuth authorization callback by:
       * 1. Parsing and validating the state parameter
       * 2. Validating the authorization code
       * 3. Finding the client associated with the callback
       * 4. Exchanging the authorization code for tokens
       * 5. Storing tokens and redirecting the user
       */
      const { verifier, ...result } = event.data;

      // Parse and validate the state parameter which contains client and redirect info
      let state: any = {};
      try {
        state = JSON.parse(decodeURIComponent(event.data.state) || "{}");
      } catch (error) {
        console.error("Error parsing state parameter:", error);
        windowClient.postMessage({
          type: "authorization-error",
          error: "Invalid state parameter",
        });
        break;
      }

      // Validate required parameters for OAuth flow
      if (!event.data.state) {
        windowClient.postMessage({
          type: "authorization-error",
          error: "Missing state parameter",
        });
        break;
      }

      if (!event.data.code) {
        windowClient.postMessage({
          type: "authorization-error",
          error: "Missing authorization code",
        });
        break;
      }

      // Retrieve clients associated with this window to find the matching one
      const clients = await self.windowManager
        .getClientsByWindowId(windowClient.id)
        .catch((e) => e);

      if (clients instanceof Error) {
        windowClient.postMessage({
          type: "authorization-error",
          error: "Failed to retrieve clients",
        });
        return;
      }

      // Find the specific client that initiated this authorization flow
      const callbackForClient = clients.find(
        (client: { clientId: any }) => client.clientId === state.clientId
      );
      if (!callbackForClient) {
        windowClient.postMessage({
          type: "authorization-error",
          error: "Client not found",
        });
        return;
      }

      // Get the OpenID configuration for this client to access token endpoint
      const callbackConfig = await self.windowManager
        .getClientConfigFromClientRecord(callbackForClient)
        .catch((e) => e);

      if (callbackConfig instanceof Error) {
        windowClient.postMessage({
          type: "authorization-error",
          error: "Failed to retrieve client configuration",
        });
        return;
      }

      // Prepare the token exchange request body with PKCE verification
      const body = encodedStringFromObject({
        client_id: callbackForClient.clientId,
        code: result.code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: self.location.origin + callbackForClient.callbackPath,
      });

      // Exchange authorization code for access and refresh tokens
      const fetchResponse = await fetch(callbackConfig.token_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body,
      });
      if (!fetchResponse.ok) {
        windowClient.postMessage({
          type: "authorization-error",
          error: `Token request failed: ${fetchResponse.status} ${fetchResponse.statusText}`,
        });
        return;
      }

      // Parse the token response and handle any JSON parsing errors
      const tokenData = await fetchResponse.json().catch((e) => e);
      if (tokenData instanceof Error) {
        console.error("Error parsing token response:", tokenData);
        windowClient.postMessage({
          type: "authorization-error",
          error: "Failed to parse token response",
        });
        return;
      }

      // Store the tokens in the window manager for future use
      self.windowManager.setTokens(callbackForClient.clientId, tokenData);

      // Redirect the user back to their original destination
      windowClient.postMessage({
        type: "redirect",
        url: state.url,
      });

      break;

    case "logout":
      const { clientId, sessionId, url } = event.data;
      const clientsInWindow = await self.windowManager.getClientsByWindowId(
        windowClient.id
      );
      if (!clientsInWindow || clientsInWindow.length === 0) {
        console.error("[SW] No clients found for window ID:", windowClient.id);
        return;
      }
      const clientToLogoff = clientsInWindow.find(
        (c) => c.clientId === clientId
      );

      if (!clientToLogoff) {
        console.error("[SW] Client not found for logoff:", clientId);
        return;
      }

      const clientConfig =
        await self.windowManager.getClientConfigFromClientRecord(
          clientToLogoff
        );
      if (!clientConfig) {
        console.error(
          "[SW] Client configuration not found for logoff:",
          clientId
        );
        return;
      }
      const logoutTokenData = await self.windowManager.getTokens(clientId);
      if (!logoutTokenData?.id_token) {
        console.error("[SW] No ID token found for logoff:", clientId);
        return;
      }
      const revocationEndpoint = clientConfig.revocation_endpoint;
      if (!revocationEndpoint) {
        console.warn(
          "[SW] No revocation endpoint configured, skipping token revocation"
        );
      } else {
        // Revoke tokens with error handling
        try {
          await revokeToken(
            revocationEndpoint,
            clientId,
            "access_token",
            logoutTokenData.access_token
          );

          if (logoutTokenData.refresh_token) {
            await revokeToken(
              revocationEndpoint,
              clientId,
              "refresh_token",
              logoutTokenData.refresh_token
            );
          }
        } catch (error) {
          console.warn("[SW] Token revocation failed:", error);
          // Continue with logout even if revocation fails
        }
      }

      await self.windowManager.deleteTokens(clientId);

      const redirectUrl = clientConfig.end_session_endpoint;
      const redirectParams =
        "?" +
        encodedStringFromObject(
          {
            id_token_hint: logoutTokenData.id_token,
            post_logout_redirect_uri:
              self.location.origin +
              clientToLogoff.callbackPath +
              "?c=" +
              clientId +
              "#post_end_session_redirect_uri=" +
              encodeURIComponent(url),
          },
          encodeURIComponent,
          "&"
        );

      windowClient.postMessage({
        type: "redirect",
        url: redirectUrl + redirectParams,
      });

      break;

    case "get-user-info":
      const port = event.ports[0];
      if (!port) {
        console.error("[SW] No port provided for user info request");
        return;
      }

      const userInfoClients = await self.windowManager.getClientsByWindowId(
        windowClient.id
      );
      if (!userInfoClients || userInfoClients.length === 0) {
        console.error("[SW] No clients found for window ID:", windowClient.id);
        return;
      }
      const userInfoClient = userInfoClients.find(
        (c) => c.clientId === event.data.clientId
      );
      if (!userInfoClient) {
        console.error(
          "[SW] Client not found for user info:",
          event.data.clientId
        );
        return;
      }
      const userInfoConfig =
        await self.windowManager.getClientConfigFromClientRecord(
          userInfoClient
        );
      if (!userInfoConfig || !userInfoConfig.userinfo_endpoint) {
        console.error(
          "[SW] Client config or userinfo endpoint not found for user info:",
          event.data.clientId
        );
        port.postMessage({
          type: "user-info-error",
          error: "User info endpoint not available",
        });
        return;
      }
      const userInfoTokenData = await self.windowManager.getTokens(
        userInfoClient.clientId
      );
      if (!userInfoTokenData?.access_token) {
        console.error(
          "[SW] No access token found for user info:",
          event.data.clientId
        );
        port.postMessage({
          type: "user-info-error",
          error: "No access token available",
        });
        return;
      }
      const userInfoResponse = await fetch(userInfoConfig.userinfo_endpoint, {
        headers: {
          Authorization: `Bearer ${userInfoTokenData.access_token}`,
        },
      });
      if (!userInfoResponse.ok) {
        console.error(
          "[SW] User info request failed:",
          userInfoResponse.status,
          userInfoResponse.statusText
        );
        port.postMessage({
          type: "user-info-error",
          error: `User info request failed: ${userInfoResponse.status} ${userInfoResponse.statusText}`,
        });
        return;
      }
      const userInfoData = await userInfoResponse.json().catch((e) => e);
      if (userInfoData instanceof Error) {
        console.error("[SW] Error parsing user info response:", userInfoData);
        port.postMessage({
          type: "user-info-error",
          error: "Failed to parse user info response",
        });
        return;
      }

      port.postMessage({
        type: "user-info-response",
        userInfo: userInfoData,
      });
      break;

    default:
      console.warn("[SW] Unknown message type:", event.data.type);
      break;
  }
});

/**
 * Revoke a token
 *
 * @param tokenEndpoint
 * @param clientId
 * @param tokenType
 * @param token
 * @returns Promise<Response>
 */
function revokeToken(
  tokenEndpoint: string,
  clientId: string,
  tokenType: string,
  token: string
): Promise<Response> {
  const body = encodedStringFromObject({
    client_id: clientId,
    token,
    token_type_hint: tokenType,
  });
  return fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
  });
}
