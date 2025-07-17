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
 * OIDC Configuration interface
 */
export interface OIDCConfiguration {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  end_session_endpoint?: string;
  revocation_endpoint?: string;
  
}
