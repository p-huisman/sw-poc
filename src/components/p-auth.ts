import { RegisterClientRequestData } from "../interfaces";
import { stopFetchQueuing, startFetchQueuing } from "./fetch-queue";
import { PAuthClient } from "../interfaces";
import {
  encodedStringFromObject,
  generateRandomString,
  pkceChallengeFromVerifier,
} from "../helpers/crypto";

startFetchQueuing();

/**
 * Custom HTML element that manages OAuth/OpenID Connect authentication through a service worker.
 * Handles service worker registration, client registration, authorization flows, and callback processing.
 * 
 * @fires authInitialised - Dispatched when all auth clients are registered and ready
 * @fires authError - Dispatched when an error occurs during authentication setup
 * @fires authConnected - Dispatched when the element is connected to the DOM
 * 
 * @example
 * ```html
 * <p-auth sw-url="/auth-sw.js" sw-scope="/">
 *   <p-code-flow 
 *     client-id="your-client-id"
 *     discovery-url="https://accounts.google.com"
 *     scope="openid profile email">
 *   </p-code-flow>
 * </p-auth>
 * ```
 */
export class PAuthElement extends HTMLElement {
  /**
   * Creates a new PAUthElement instance.
   * Initializes the service worker promise and begins service worker registration.
   */
  constructor() {
    super();
    this.serviceWorker = new Promise((resolve, reject) => {
      this.#swResolveFn = resolve;
      this.#swRejectFn = reject;
    });

    this.#registerServiceWorker();
  }

  /** Resolver function for the service worker promise */
  #swResolveFn!: (sw: ServiceWorker) => void;

  /** Rejection function for the service worker promise */
  #swRejectFn!: (error: Error) => void;

  /** Promise that resolves when the service worker is ready */
  serviceWorker: Promise<ServiceWorker> | null = null;

  /**
   * Handles messages received from the service worker.
   * Processes client registration, authorization requests, and redirect commands.
   * 
   * @param event - The MessageEvent from the service worker
   */
  #onServiceWorkerMessage = (event: MessageEvent) => {
    try {
      switch (event.data.type) {
        case "client-registration-error":
        case "client-registered":
          this.#clientRegistered(event);
          break;
        case "authorize":
          this.#authorize(event);
          break;
        case "redirect":
          const url = event.data.url;
          if (url) {
            document.location.href = url;
          }
          break;
        default:
          console.warn("[p-auth] Unknown message type:", event.data.type);
      }
    } catch (error) {
      console.error("[p-auth] Error handling service worker message:", error);
    }
  };

  /**
   * Handles the client registration confirmation from the service worker.
   * Marks clients as initialised and processes authorization callbacks if present.
   * Dispatches the 'authInitialised' event when all clients are registered.
   * 
   * @param event - MessageEvent containing the clientId of the registered client
   */
  #clientRegistered(event: MessageEvent) {
    const clientId = event.data.clientId;

    // Find all auth client elements that are children of this element
    const authClients = Array.from(this.children).filter(
      (node): node is PAuthClient => "clientId" in node && "initialised" in node
    );

    // Mark the specific client as initialised
    authClients.forEach((client) => {
      if (client.clientId === clientId) {
        client.initialised = true;
      }
    });

    // Check if all clients are now initialised
    const allClientsReady = authClients.every((client) => client.initialised);
    if (allClientsReady && authClients.length > 0) {
      const verifier = sessionStorage.getItem("p-oauth-verifier");
      const isAuthorizeCallback = document.location.hash.includes("code=") && verifier;
      const isAuthorizeCallbackError = document.location.hash.includes("error=") && verifier;

      // Clean up the verifier from storage
      sessionStorage.removeItem("p-oauth-verifier");

      // If this is an authorization callback, process it
      if (isAuthorizeCallback && verifier) {
        const result = this.#getAuthoriseCallbackResult();
        if (this.serviceWorker) {
          this.serviceWorker.then((sw) => {
            sw.postMessage({ verifier, type: "authorize-callback", ...result });
          });
        }
      }
      if (isAuthorizeCallbackError) {
        console.error("[p-auth] Authorization callback error:", event.data.error);
        this.dispatchEvent(
          new CustomEvent("authError", { bubbles: true, composed: true, detail: { error: event.data } })
        );
      }

      // Notify that the auth system is ready
      this.dispatchEvent(
        new CustomEvent("authInitialised", { bubbles: true, composed: true })
      );

      // Stop queuing fetch requests since auth is now ready
      stopFetchQueuing(false);
    }
  }

  /**
   * Initiates the OAuth authorization flow using PKCE (Proof Key for Code Exchange).
   * Generates a code verifier, creates the authorization URL, and redirects the user.
   * 
   * @param event - MessageEvent containing authorization parameters (clientId, scope, url, callbackPath)
   */
  #authorize(event: MessageEvent) {
    // Prevent multiple concurrent authorization attempts
    if (sessionStorage.getItem("p-oauth-verifier")) {
      console.warn("[p-auth] Authorization already in progress");
      return;
    }

    // Generate PKCE verifier and store it for the callback
    const verifier = generateRandomString();
    sessionStorage.setItem("p-oauth-verifier", verifier);

    // Generate the PKCE challenge from the verifier
    pkceChallengeFromVerifier(verifier).then((codeChallenge) => {
      // Build the authorization request parameters
      const tokenLocationParams = {
        client_id: event.data.clientId,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        response_mode: "fragment",
        response_type: "code",
        scope: event.data.scope,
        redirect_uri: new URL(
          event.data.callbackPath,
          window.location.origin
        ).toString(),
        state: JSON.stringify({
          silent: false,
          clientId: event.data.clientId,
          url: document.location.href,
        }),
      };

      // Construct the authorization URL and redirect
      const location =
        event.data.url +
        "?" +
        encodedStringFromObject(tokenLocationParams, encodeURIComponent, "&");
      document.location = location;
    });
  }

  /**
   * Registers the authentication service worker and sets up message handling.
   * Uses the 'sw-url' and 'sw-scope' attributes to configure the service worker.
   * Falls back to '/sw.js' and '/' if attributes are not provided.
   */
  #registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      // Get service worker configuration from element attributes
      const swUrl = this.getAttribute("sw-url") || "/sw.js";
      const scope = this.getAttribute("sw-scope") || "/";

      // Set up message listener for service worker communications
      navigator.serviceWorker.addEventListener(
        "message",
        this.#onServiceWorkerMessage
      );

      // Register the service worker
      navigator.serviceWorker
        .register(swUrl, { scope })
        .then((registration) => {
          const resolveWorker = (worker: ServiceWorker) => {
            this.#swResolveFn(worker);
          };

          // Handle different service worker states
          if (registration.active) {
            resolveWorker(registration.active);
          } else if (registration.installing) {
            const installingWorker = registration.installing;
            installingWorker.onstatechange = () => {
              if (installingWorker.state === "activated") {
                resolveWorker(installingWorker);
              }
            };
          } else if (registration.waiting) {
            // Handle case where service worker is waiting
            resolveWorker(registration.waiting);
          }
        })
        .catch((error) => {
          console.error("Service Worker registration failed:", error);
          this.#swRejectFn(error);
          stopFetchQueuing();
        });
    } else {
      // Fallback for browsers without service worker support
      console.warn("Service Workers are not supported in this browser.");
      this.#swRejectFn(
        new Error("Service Workers are not supported in this browser.")
      );
      stopFetchQueuing();
    }
  }

  /**
   * Parses the authorization callback result from URL parameters.
   * Handles both hash-based and query string-based responses from OAuth providers.
   * 
   * @returns Object containing the parsed authorization callback parameters
   */
  #getAuthoriseCallbackResult(): Record<string, string> {
    let queryString = "";

    // Handle OAuth responses that come via hash fragment (most common)
    if (document.location.search.length === 0 && document.location.hash.length > 0) {
      queryString = document.location.hash.substring(1);
      if (queryString.indexOf("?") > -1) {
        queryString = queryString.split("?")[1];
      }
    }
    // Handle OAuth responses that come via query string
    else if (document.location.search.length > 0 && document.location.hash.length === 0) {
      queryString = document.location.search.substring(1);
    }

    // Parse the query string into an object with proper error handling
    if (!queryString) {
      return {};
    }

    return queryString.split("&")
      .filter(item => item.includes("=")) // Filter out malformed parameters
      .reduce((result: Record<string, string>, item) => {
        const parts = item.split("=");
        const key = decodeURIComponent(parts[0]);
        const value = parts[1] ? decodeURIComponent(parts[1]) : "";
        result[key] = value;
        return result;
      }, {} as Record<string, string>);
  }



  /**
   * Logs off the current user by sending a logout request to the service worker.
   * This will notify the service worker to handle any cleanup.
   *
   * @param client - The PAuthClient instance that is requesting the logout
   */
  async logout(client: PAuthClient, url?: string) {
    const sw = await this.serviceWorker;
    if (!url) {
      url = location.href.split(window.origin)[1];
    }
    if (!sw) {
      console.error("[p-auth] Service Worker is not available");
      return;
    }
    sw.postMessage({ type: "logout", clientId: client.clientId, url });
  }

  /**
   * Called when the element is connected to the DOM.
   * Dispatches the 'authConnected' event and registers the session with the service worker.
   */
  async connectedCallback() {
    if (document.location.hash.includes("post_end_session_redirect_uri")) {
      try {
        const hashParts = document.location.hash.split("=");
        if (hashParts.length < 2) {
          console.error("[p-auth] Invalid post_end_session_redirect_uri format");
          return;
        }

        const redirect = decodeURIComponent(hashParts[1]);
        const redirectUrl = new URL(redirect, window.location.origin);

        // Security check: only allow same-origin redirects
        if (redirectUrl.origin === window.location.origin) {
          // Prevent redirect loops by cleaning the hash
          if (redirectUrl.hash.includes("post_end_session_redirect_uri")) {
            redirectUrl.hash = "";
          }
          document.location.href = redirectUrl.toString();
        } else {
          console.error("[p-auth] Invalid redirect origin:", redirectUrl.origin);
        }
      } catch (error) {
        console.error("[p-auth] Error processing post_end_session_redirect_uri:", error);
      }
      return;
    }
    this.dispatchEvent(
      new CustomEvent("authConnected", { bubbles: true, composed: true })
    );

    try {
      const sw = await this.serviceWorker;
      if (!sw) {
        console.error("[p-auth] Service Worker is not available");
        this.#swRejectFn(new Error("Service Worker is not available"));
        return;
      }
    } catch (error) {
      console.error(
        "[p-auth] Failed to register session with service worker:",
        error
      );
      this.dispatchEvent(
        new CustomEvent("authError", {
          bubbles: true,
          composed: true,
          detail: { error },
        })
      );
    }
  }

  /**
   * Called when the element is disconnected from the DOM.
   * Cleans up event listeners to prevent memory leaks.
   */
  disconnectedCallback() {
    navigator.serviceWorker.removeEventListener(
      "message",
      this.#onServiceWorkerMessage
    );
  }

  async getUserInfo(client: PAuthClient) {
    const sw = await this.serviceWorker;
    if (!sw) {
      console.error("[p-auth] Service Worker is not available");
      return Promise.reject("[p-auth] Service Worker is not available");
    }
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => {
        channel.port1.close();
        reject(new Error("Timeout waiting for user info response from service worker"));
      }, 5000);

      channel.port1.onmessage = (event) => {
        clearTimeout(timeout);
        channel.port1.close();
        if (event.data && event.data.type === "user-info-response") {
          resolve(event.data.userInfo);
        } else if (event.data && event.data.type === "user-info-error") {
          reject(event.data.error);
        } else {
          reject(new Error("Unexpected response from service worker"));
        }
      };

      sw.postMessage(
        {
          type: "get-user-info",
          clientId: client.clientId,
        },
        [channel.port2]
      );
    });
  }



  /**
   * Registers an authentication client with the service worker.
   * Validates the client configuration and sends registration data to the service worker.
   * 
   * @param client - The PAuthClient instance to register
   * @throws {Error} When service worker is not ready or client configuration is invalid
   * 
   * @example
   * ```typescript
   * const authElement = document.querySelector('p-auth');
   * const client = document.querySelector('p-code-flow');
   * await authElement.registerAuthClient(client);
   * ```
   */
  async registerAuthClient(client: PAuthClient) {
    try {
      // Validate that service worker is ready
      if (!this.serviceWorker) {
        throw new Error("Service Worker is not registered yet");
      }

      // Validate required client properties
      if (!client.clientId) {
        throw new Error("Client must have a valid clientId");
      }

      if (!client.discoveryUrl) {
        throw new Error("Client must have a valid discoveryUrl");
      }

      if (!client.scope) {
        throw new Error("Client must have a valid scope");
      }

      if (!client.urlPattern) {
        throw new Error("Client must have a valid urlPattern");
      }

      // Wait for service worker to be available
      const sw = await this.serviceWorker;
      if (!sw) {
        throw new Error("Service Worker is not available");
      }

      // Build and send the registration request
      const registerRequest: RegisterClientRequestData = {
        type: "register-client",
        clientId: client.clientId,
        discoveryUrl: client.discoveryUrl,
        scope: client.scope,
        callbackPath: client.callbackPath || "",
        urlPattern: client.urlPattern || "",
        clientType: client.tagName.toLowerCase(),
      };
      sw.postMessage(registerRequest);
    } catch (error) {
      console.error("[p-auth] Failed to register auth client:", error);
      throw error; // Re-throw so caller can handle
    }
  }
}

/**
 * Registers the p-auth custom element with the browser.
 * This allows the element to be used in HTML as <p-auth>.
 * 
 * @see https://developer.mozilla.org/en-US/docs/Web/API/CustomElementRegistry/define
 */
customElements.define("p-auth", PAuthElement);
