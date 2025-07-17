/** Cache for ongoing requests to prevent duplicate fetches */
const pendingRequests = new Map<string, Promise<any>>();

/** Maximum allowed response size for OpenID discovery documents (1MB) */
const MAX_RESPONSE_SIZE = 1024 * 1024; // 1MB limit

/** Cache duration for OpenID discovery documents (1 hour) */
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

/**
 * Fetches and caches OpenID Connect discovery configuration from a provider.
 * Automatically appends the well-known discovery path if not present in the URL.
 * Implements caching, request deduplication, and comprehensive validation.
 * 
 * @param serviceWorkerGlobalScope - The service worker global scope for fetch and cache access
 * @param discoveryUrl - The OpenID Connect discovery URL (with or without .well-known path)
 * @returns Promise resolving to the OpenID Connect discovery document
 * @throws {Error} When URL is invalid, not HTTPS, or discovery document is malformed
 * 
 * @example
 * ```typescript
 * const config = await getOpenIdConfiguration(
 *   self,
 *   'https://accounts.google.com'
 * );
 * console.log(config.token_endpoint);
 * ```
 */
export async function getOpenIdConfiguration(
  serviceWorkerGlobalScope: ServiceWorkerGlobalScope,
  discoveryUrl: string,
) {
  // Input validation
  if (!discoveryUrl || typeof discoveryUrl !== 'string') {
    throw new Error('Discovery URL is required and must be a string');
  }

  // Validate URL format and ensure HTTPS for security
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(discoveryUrl);
  } catch {
    throw new Error(`Invalid discovery URL format: ${discoveryUrl}`);
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new Error('Discovery URL must use HTTPS protocol for security');
  }

  // Normalize the discovery URL by appending well-known path if missing
  let url = discoveryUrl;
  if (url.indexOf(".well-known/openid-configuration") < 0) {
    if (url.slice(-1) !== "/") {
      url = url + "/";
    }
    url = url + ".well-known/openid-configuration";
  }

  // Check for ongoing request to prevent race conditions and duplicate fetches
  if (pendingRequests.has(url)) {
    return pendingRequests.get(url);
  }

  // Create and track the request promise
  const requestPromise = fetchOpenIdConfiguration(serviceWorkerGlobalScope, url);
  pendingRequests.set(url, requestPromise);

  try {
    const result = await requestPromise;
    return result;
  } finally {
    // Clean up the pending request regardless of success or failure
    pendingRequests.delete(url);
  }
}

/**
 * Fetches OpenID Connect configuration with caching support.
 * Checks cache first, then fetches fresh data if needed or cache is expired.
 * 
 * @param serviceWorkerGlobalScope - The service worker global scope for fetch and cache access
 * @param url - The complete OpenID Connect discovery URL
 * @returns Promise resolving to the cached or freshly fetched discovery document
 */
async function fetchOpenIdConfiguration(
  serviceWorkerGlobalScope: ServiceWorkerGlobalScope,
  url: string,
) {
  let cache: Cache;
  
  try {
    cache = await serviceWorkerGlobalScope.caches.open("openIdDiscovery");
  } catch (cacheError) {
    console.warn('[OpenID] Cache not available, proceeding without cache:', cacheError);
    // Fallback to direct fetch without caching
    return fetchDiscoveryDocument(serviceWorkerGlobalScope, url);
  }

  // Check cache first for existing valid data
  try {
    const discoveryResponse = await cache.match(url);
    if (discoveryResponse) {
      const data = await discoveryResponse.json();
      const isExpired = new Date().getTime() - data.timestamp > CACHE_DURATION;
      if (data.timestamp && !isExpired) {
        return data;
      }
    }
  } catch (cacheReadError) {
    console.warn('[OpenID] Failed to read from cache:', cacheReadError);
  }

  // Fetch fresh data from the OpenID provider
  const data = await fetchDiscoveryDocument(serviceWorkerGlobalScope, url);
  
  // Try to cache the result for future use
  try {
    data.timestamp = new Date().getTime();
    await cache.put(url, new Response(JSON.stringify(data)));
  } catch (cacheWriteError) {
    console.warn('[OpenID] Failed to write to cache:', cacheWriteError);
  }

  return data;
}

/**
 * Performs the actual HTTP request to fetch the OpenID Connect discovery document.
 * Includes timeout protection, response validation, and security checks.
 * 
 * @param serviceWorkerGlobalScope - The service worker global scope for fetch access
 * @param url - The complete OpenID Connect discovery URL
 * @returns Promise resolving to the validated discovery document
 * @throws {Error} When request fails, times out, or response is invalid
 */
async function fetchDiscoveryDocument(
  serviceWorkerGlobalScope: ServiceWorkerGlobalScope,
  url: string,
) {
  try {
    // Set up request timeout to prevent hanging requests (10 second limit)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await serviceWorkerGlobalScope.fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });

    clearTimeout(timeoutId);

    // Check for HTTP errors
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Validate content type is JSON
    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      throw new Error(`Invalid content type: ${contentType}. Expected application/json`);
    }

    // Check response size to prevent DoS attacks
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
      throw new Error(`Response too large: ${contentLength} bytes. Maximum allowed: ${MAX_RESPONSE_SIZE} bytes`);
    }

    const data = await response.json();
    
    // Validate required OpenID Connect discovery document fields
    if (!data.issuer || !data.authorization_endpoint || !data.token_endpoint) {
      throw new Error('Invalid OpenID Connect discovery document: missing required fields');
    }

    return data;
  } catch (error) {
    // Handle specific timeout errors
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout: Failed to fetch OpenID discovery document from ${url}`);
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch OpenID discovery document from ${url}: ${errorMessage}`);
  }
}

/**
 * Retrieves a specific item from the OpenID Connect discovery configuration.
 * Fetches the discovery document and extracts the requested configuration value.
 * 
 * @param serviceWorker - The service worker global scope for fetch and cache access
 * @param discoveryUrl - The OpenID Connect discovery URL
 * @param item - The configuration item key to retrieve (e.g., 'token_endpoint', 'authorization_endpoint')
 * @returns Promise resolving to the requested configuration value as a string
 * @throws {Error} When item parameter is invalid, configuration fetch fails, or requested item is not found
 * 
 * @example
 * ```typescript
 * const tokenEndpoint = await getItemFromOpenIdConfig(
 *   self,
 *   'https://accounts.google.com',
 *   'token_endpoint'
 * );
 * ```
 */
export async function getItemFromOpenIdConfig(
  serviceWorker: ServiceWorkerGlobalScope,
  discoveryUrl: string,
  item: string,
): Promise<string> {
  // Validate input parameter
  if (!item || typeof item !== 'string') {
    throw new Error('Item parameter is required and must be a string');
  }

  try {
    // Fetch the complete OpenID Connect discovery configuration
    const discoverOpenId = await getOpenIdConfiguration(serviceWorker, discoveryUrl);
    
    // Validate the response structure
    if (!discoverOpenId || typeof discoverOpenId !== 'object') {
      throw new Error('Invalid OpenID configuration response');
    }

    // Extract the requested configuration item
    const value = discoverOpenId[item];
    
    // Check if the requested item exists
    if (value === undefined || value === null) {
      throw new Error(`Required OpenID configuration item '${item}' not found`);
    }

    // Ensure the value is a string as expected
    if (typeof value !== 'string') {
      throw new Error(`OpenID configuration item '${item}' must be a string, got ${typeof value}`);
    }

    return value;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get '${item}' from OpenID configuration: ${errorMessage}`);
  }
}
