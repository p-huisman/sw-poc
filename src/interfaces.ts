/**
 * Interface for OAuth/OIDC client elements that can be registered with p-auth
 * All implementing elements must provide these properties and capabilities
 */
export interface PAuthClient extends HTMLElement {
  /** OAuth 2.0 client identifier */
  readonly clientId: string;
  /** OpenID Connect discovery endpoint URL */
  readonly discoveryUrl: string;
  /** OAuth 2.0 scope string (space-separated) */
  readonly scope: string;
  /** Path for OAuth callback handling */
  readonly callbackPath: string;
  /** Regular expression pattern for matching URLs that need authentication */
  readonly urlPattern: string;
  /** Whether the client is registered and ready for authentication */
  initialised: boolean;

}

/**
 * Message data structure for registering OAuth clients with the service worker
 */
export interface RegisterClientRequestData {
  /** Message type identifier */
  type: 'register-client';
  /** OAuth 2.0 client identifier */
  clientId: string;
  /** OpenID Connect discovery endpoint URL */
  discoveryUrl: string;
  /** OAuth 2.0 scope string (space-separated) */
  scope: string;
  /** Path for OAuth callback handling */
  callbackPath: string;
  /** Regular expression pattern for matching URLs that need authentication */
  urlPattern: string;
  /** Type/name of the client element */
  clientType: string;
}

/**
 * OAuth/OIDC token data structure
 */
export interface TokenData {
  /** OAuth access token */
  access_token: string;
  /** OAuth ID token (if applicable) */
  id_token?: string;
  /** OAuth refresh token (optional) */
  refresh_token?: string;
  /** Token type (usually "Bearer") */
  token_type: string;
  /** Token expiration time in seconds */
  expires_in?: number;
  /** Calculated expiration timestamp (internal use) */
  expires_at?: number;
}

/**
 * Client registration record for window management
 */
export interface WindowClientRecord {
  /** Unique window identifier */
  windowId: string;
  /** OAuth client identifier */
  clientId: string;
  /** OIDC discovery endpoint URL */
  discoveryUrl: string;
  /** OAuth scope string */
  scope: string;
  /** Callback path for authorization flow */
  callbackPath: string;
  /** URL pattern for request matching */
  urlPattern: string;
  /** Type of OAuth client */
  clientType: string;
}

/**
 * Message types used for communication between the window (p-auth element)
 * and the service worker. Shared single source of truth so both sides stay
 * in sync and typos are caught at compile time.
 */
export const PAuthMessage = {
  /** window → SW: register a new OAuth client */
  RegisterClient: "register-client",
  /** window → SW: process an OAuth authorization callback */
  AuthorizeCallback: "authorize-callback",
  /** window → SW: log out a client */
  Logout: "logout",
  /** window → SW: request user info (answered over a MessageChannel port) */
  GetUserInfo: "get-user-info",
  /** SW → window: client registration succeeded */
  ClientRegistered: "client-registered",
  /** SW → window: client registration failed */
  ClientRegistrationError: "client-registration-error",
  /** SW → window: start the authorization flow */
  Authorize: "authorize",
  /** SW → window: authorization failed */
  AuthorizationError: "authorization-error",
  /** SW → window: perform a redirect */
  Redirect: "redirect",
  /** SW → window (port): user info result */
  UserInfoResponse: "user-info-response",
  /** SW → window (port): user info failure */
  UserInfoError: "user-info-error",
} as const;

/** Union of all valid message type strings */
export type PAuthMessageType = (typeof PAuthMessage)[keyof typeof PAuthMessage];

/**
 * OIDC Configuration interface
 */
export interface OIDCConfiguration {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  end_session_endpoint?: string;
  revocation_endpoint?: string;
  
}
