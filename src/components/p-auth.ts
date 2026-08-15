import {
  PAuthClient,
  PAuthMessage,
  RegisterClientRequestData,
} from "../interfaces";
import { stopFetchQueuing, startFetchQueuing } from "./fetch-queue";
import {
  encodedStringFromObject,
  generateRandomString,
  pkceChallengeFromVerifier,
} from "../helpers/crypto";

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
  }

  /** Resolver function for the service worker promise */
  #swResolveFn!: (sw: ServiceWorker) => void;

  /** Rejection function for the service worker promise */
  #swRejectFn!: (error: Error) => void;

  /** Whether the service worker registration has been set up */
  #isSetup = false;

  /** IDs of clients whose registration failed in the service worker */
  #failedClientIds = new Set<string>();

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
        case PAuthMessage.ClientRegistrationError:
          this.#clientRegistrationError(event);
          break;
        case PAuthMessage.ClientRegistered:
          this.#clientRegistered(event);
          break;
        case PAuthMessage.Authorize:
          this.#authorize(event);
          break;
        case PAuthMessage.Redirect:
          const url = event.data.url;
          if (typeof url === "string" && url) {
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

    // Mark the specific client as initialised
    this.#getAuthClients().forEach((client) => {
      if (client.clientId === clientId) {
        client.initialised = true;
      }
    });

    this.#checkAllClientsSettled();
  }

  /**
   * Handles a client registration failure reported by the service worker.
   * Dispatches an 'authError' event and tracks the failure so the client is
   * never marked as ready (and the fetch queue is not flushed for it).
   *
   * @param event - MessageEvent containing the clientId and error
   */
  #clientRegistrationError(event: MessageEvent) {
    const { clientId, error } = event.data ?? {};
    console.error(
      `[p-auth] Client registration failed for "${clientId}":`,
      error
    );
    if (clientId) {
      this.#failedClientIds.add(clientId);
    }
    this.dispatchEvent(
      new CustomEvent("authError", {
        bubbles: true,
        composed: true,
        detail: { clientId, error },
      })
    );

    this.#checkAllClientsSettled();
  }

  /**
   * Finds all auth client elements that are children of this element.
   *
   * @returns Array of PAuthClient child elements
   */
  #getAuthClients(): PAuthClient[] {
    return Array.from(this.children).filter(
      (node): node is PAuthClient => "clientId" in node && "initialised" in node
    );
  }

  /**
   * Checks whether all auth clients have settled (registered or failed).
   * When settled, processes any pending authorization callback, dispatches
   * the 'authInitialised' event and flushes the queued fetch requests.
   */
  #checkAllClientsSettled() {
    const authClients = this.#getAuthClients();

    // Check if all clients are now settled (initialised or failed)
    const allClientsSettled =
      authClients.length > 0 &&
      authClients.every(
        (client) =>
          client.initialised || this.#failedClientIds.has(client.clientId)
      );
    if (!allClientsSettled) {
      return;
    }

    const verifier = sessionStorage.getItem("p-oauth-verifier");
    const expectedState = sessionStorage.getItem("p-oauth-state");
    const callbackResult = this.#getAuthoriseCallbackResult();
    const isAuthorizeCallback = !!verifier && "code" in callbackResult;
    const isAuthorizeCallbackError = !!verifier && "error" in callbackResult;

    // Clean up the stored flow values
    sessionStorage.removeItem("p-oauth-verifier");
    sessionStorage.removeItem("p-oauth-state");

    // If this is an authorization callback, process it
    if (isAuthorizeCallback && verifier) {
      // Validate the OAuth state parameter to protect against CSRF attacks:
      // the nonce must match the one stored when the flow was initiated.
      let stateIsValid = false;
      try {
        const state = JSON.parse(callbackResult.state || "{}");
        stateIsValid = !!expectedState && state.nonce === expectedState;
      } catch {
        stateIsValid = false;
      }

      if (!stateIsValid) {
        console.error(
          "[p-auth] Invalid OAuth state parameter - possible CSRF attack, aborting callback"
        );
        this.dispatchEvent(
          new CustomEvent("authError", {
            bubbles: true,
            composed: true,
            detail: { error: "Invalid OAuth state parameter" },
          })
        );
      } else if (this.serviceWorker) {
        this.serviceWorker.then((sw) => {
          sw.postMessage({
            verifier,
            type: PAuthMessage.AuthorizeCallback,
            ...callbackResult,
          });
        });
      }
    }
    if (isAuthorizeCallbackError) {
      console.error(
        "[p-auth] Authorization callback error:",
        callbackResult.error
      );
      this.dispatchEvent(
        new CustomEvent("authError", {
          bubbles: true,
          composed: true,
          detail: {
            error: callbackResult.error,
            errorDescription: callbackResult.error_description,
          },
        })
      );
    }

    // Notify that the auth system is ready
    this.dispatchEvent(
      new CustomEvent("authInitialised", { bubbles: true, composed: true })
    );

    // Stop queuing fetch requests since auth is now ready
    stopFetchQueuing(false);
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

    // Generate a random state nonce and store it so the callback can be
    // validated (CSRF protection)
    const stateNonce = generateRandomString();
    sessionStorage.setItem("p-oauth-state", stateNonce);

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
          nonce: stateNonce,
          silent: false,
          clientId: event.data.clientId,
          url: document.location.href,
        }),
      };

      // Construct the authorization URL and redirect
      const authorizationUrl =
        event.data.url +
        "?" +
        encodedStringFromObject(tokenLocationParams, encodeURIComponent, "&");
      document.location.href = authorizationUrl;
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

    // Parse the parameters into an object. URLSearchParams handles decoding
    // and correctly supports values containing "=" characters.
    const result: Record<string, string> = {};
    if (!queryString) {
      return result;
    }
    new URLSearchParams(queryString).forEach((value, key) => {
      result[key] = value;
    });
    return result;
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
      url = location.pathname + location.search + location.hash;
    }
    if (!sw) {
      console.error("[p-auth] Service Worker is not available");
      return;
    }
    sw.postMessage({ type: PAuthMessage.Logout, clientId: client.clientId, url });
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

    // Set up the service worker registration once the element is connected:
    // attributes are only reliably available here (not in the constructor for
    // parser-created elements). The message listener must be (re-)attached on
    // every connection because disconnectedCallback removes it; re-adding the
    // same listener reference is a no-op when it is already registered.
    if (!this.#isSetup) {
      this.#isSetup = true;
      // Queue page fetches until authentication is ready, so requests made
      // during startup can be replayed through the service worker
      startFetchQueuing();
      this.#registerServiceWorker();
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener(
        "message",
        this.#onServiceWorkerMessage
      );
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
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.removeEventListener(
        "message",
        this.#onServiceWorkerMessage
      );
    }
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
        if (event.data && event.data.type === PAuthMessage.UserInfoResponse) {
          resolve(event.data.userInfo);
        } else if (event.data && event.data.type === PAuthMessage.UserInfoError) {
          reject(event.data.error);
        } else {
          reject(new Error("Unexpected response from service worker"));
        }
      };

      sw.postMessage(
        {
          type: PAuthMessage.GetUserInfo,
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
        type: PAuthMessage.RegisterClient,
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
