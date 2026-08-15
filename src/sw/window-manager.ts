import { get, delMany, keys, set } from "idb-keyval";
import { getOpenIdConfiguration } from "./openid-configurations";
import { OIDCConfiguration, PAuthMessage, TokenData, WindowClientRecord } from "../interfaces";


/**
 * Manages OAuth/OIDC authentication windows and token storage in a Service Worker context.
 * Provides centralized management for client registration, token persistence, and authorization flows.
 * 
 * Uses IndexedDB for persistent token storage and manages the lifecycle of authentication windows.
 * Implements singleton pattern to ensure single instance across the service worker.
 */
export class ClientManager {
  private static instance: ClientManager;

  /** Prefix for token storage keys in IndexedDB */
  private readonly TOKEN_STORE_PREFIX = 'token_';

  /** Skew allowance when checking token expiration (30 seconds) */
  private readonly EXPIRY_SKEW_MS = 30000;

  /** In-memory cache of client records per window, avoiding IndexedDB reads on every intercepted request */
  private clientCache = new Map<string, WindowClientRecord[]>();

  private constructor(private sw: ServiceWorkerGlobalScope) {}

  /**
   * Gets or creates the singleton WindowManager instance
   * @param sw - Service Worker global scope
   * @returns The WindowManager singleton instance
   */
  public static getInstance(sw: ServiceWorkerGlobalScope): ClientManager {
    if (!ClientManager.instance) {
      ClientManager.instance = new ClientManager(sw);
    }
    return ClientManager.instance;
  }

  // ============================================================================
  // CLIENT MANAGEMENT METHODS
  // ============================================================================

  /**
   * Registers a new OAuth client with the window manager
   * Also performs cleanup of stale client registrations for closed windows
   * 
   * @param client - The client record to register
   * @throws {Error} If client registration fails
   */
  async registerClient(client: WindowClientRecord): Promise<void> {
    // Get all active window IDs
    const allClients = await this.sw.clients.matchAll({ type: "window" });
    const allWindowIds = allClients.map((client) => client.id);

    // Register the new client
    const result = await set(`${client.windowId} ${client.clientId}`, {
      ...client,
    }).catch((error) => error);

    if (result instanceof Error) {
      console.error(
        `[ClientManager] Failed to register client ${client.clientId} for window ${client.windowId}:`,
        result
      );
      return Promise.reject(result);
    }

    // Update the in-memory cache (write-through)
    const cachedClients = this.clientCache.get(client.windowId) ?? [];
    this.clientCache.set(client.windowId, [
      ...cachedClients.filter((c) => c.clientId !== client.clientId),
      client,
    ]);

    // Clean up stale client registrations
    await this.cleanupStaleClients(allWindowIds);
  }

  /**
   * Retrieves all registered clients for a specific window
   * 
   * @param windowId - The window ID to search for
   * @returns Array of client records for the specified window
   */
  async getClientsByWindowId(windowId: string): Promise<WindowClientRecord[]> {
    // Serve from the in-memory cache when possible (hot path: called for
    // every intercepted fetch request)
    const cachedClients = this.clientCache.get(windowId);
    if (cachedClients) {
      return cachedClients;
    }

    const clients: WindowClientRecord[] = [];
    const allRegisteredClients = await keys().catch((): string[] => []);

    for (const key of allRegisteredClients) {
      const [id] = key.toString().split(" ", 2);
      if (id === windowId) {
        const client = await get(key).catch((): null => null);
        if (client) {
          clients.push(client as WindowClientRecord);
        }
      }
    }

    this.clientCache.set(windowId, clients);
    return clients;
  }

  /**
   * Removes stale client registrations for windows that are no longer active
   * 
   * @private
   * @param activeWindowIds - Array of currently active window IDs
   */
  private async cleanupStaleClients(activeWindowIds: string[]): Promise<void> {
    const allRegisteredClients = await keys().catch((): string[] => []);
    const toBeRemoved: string[] = [];
    
    allRegisteredClients.forEach((key) => {
      const [windowId] = key.toString().split(" ", 2);
      // Skip token keys and only remove client keys for inactive windows
      if (!windowId.startsWith(this.TOKEN_STORE_PREFIX) && !activeWindowIds.includes(windowId)) {
        toBeRemoved.push(key as string);
      }
    });

    // Purge cached records for windows that are no longer active
    for (const cachedWindowId of this.clientCache.keys()) {
      if (!activeWindowIds.includes(cachedWindowId)) {
        this.clientCache.delete(cachedWindowId);
      }
    }

    if (toBeRemoved.length > 0) {
      delMany(toBeRemoved).catch((e) =>
        console.error(`[ClientManager] Failed to remove stale clients:`, e)
      );
    }
  }

  // ============================================================================
  // TOKEN MANAGEMENT METHODS
  // ============================================================================
  /**
   * Stores OAuth tokens in IndexedDB with automatic expiration calculation.
   * Computes the absolute `expires_at` timestamp from `expires_in` when the
   * provider supplies it.
   *
   * @param clientId - OAuth client identifier
   * @param tokenData - Token data to store
   * @throws {Error} If token storage fails
   */
  async setTokens(clientId: string, tokenData: TokenData): Promise<void> {
    const tokenKey = `${this.TOKEN_STORE_PREFIX}${clientId}`;
    await set(tokenKey, {
      ...tokenData,
      // Per RFC 6749 section 5.1, expires_in is relative to the time the
      // token response was generated (i.e. approximately now)
      expires_at: tokenData.expires_in
        ? Date.now() + tokenData.expires_in * 1000
        : tokenData.expires_at,
    });
  }

  /**
   * Checks whether the access token is expired. A small skew allowance is
   * applied so tokens that are about to expire are treated as expired
   * instead of failing mid-request.
   *
   * @param tokenData - Token data to check
   * @returns true when the access token is (about to be) expired
   */
  isAccessTokenExpired(tokenData: TokenData): boolean {
    if (!tokenData.expires_at) {
      return false;
    }
    return Date.now() > tokenData.expires_at - this.EXPIRY_SKEW_MS;
  }

  /**
   * Retrieves OAuth tokens from IndexedDB. Expired tokens are still returned;
   * use isAccessTokenExpired() to check the access token's validity (a
   * refresh token may still be usable).
   *
   * @param clientId - OAuth client identifier
   * @returns Token data if present, null otherwise
   */
  async getTokens(clientId: string): Promise<TokenData | null> {
    const tokenKey = `${this.TOKEN_STORE_PREFIX}${clientId}`;
    return get(tokenKey).catch((): null => null);
  }

  /**
   * Removes OAuth tokens from IndexedDB
   * 
   * @param clientId - OAuth client identifier
   */
  async deleteTokens(clientId: string): Promise<void> {
    const tokenKey = `${this.TOKEN_STORE_PREFIX}${clientId}`;
    await delMany([tokenKey]).catch((e: any) =>
      console.error(`[ClientManager] Failed to delete tokens:`, e)
    );
  }

  // ============================================================================
  // OAUTH/OIDC FLOW METHODS
  // ============================================================================

  /**
   * Retrieves OpenID Connect configuration for a client
   * 
   * @param record - Client record containing discovery URL
   * @returns Promise resolving to OIDC configuration
   */
  async getClientConfigFromClientRecord(record: WindowClientRecord): Promise<OIDCConfiguration> {
    return getOpenIdConfiguration(this.sw, record.discoveryUrl);
  }

  /**
   * Initiates OAuth authorization flow for a client
   * Sends authorization request to the client window
   * 
   * @param record - Client record for the authorization request
   * @throws {Error} If window client is not found
   */
  async authorize(record: WindowClientRecord): Promise<void> {
    const windowClient = await this.sw.clients.get(record.windowId);
    const config = await this.getClientConfigFromClientRecord(record);
    
    if (!windowClient) {
      throw new Error(`Window client ${record.windowId} not found`);
    }
    
    windowClient.postMessage({
      type: PAuthMessage.Authorize,
      clientId: record.clientId,
      callbackPath: record.callbackPath,
      scope: record.scope,
      url: config.authorization_endpoint,
    });
    
    // Note: This method initiates authorization but doesn't wait for completion
    // The authorization result will be handled via the "authorize-callback" message
  }
}
