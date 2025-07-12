// Cache for ongoing requests to prevent duplicate fetches
const pendingRequests = new Map<string, Promise<any>>();

const MAX_RESPONSE_SIZE = 1024 * 1024; // 1MB limit
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

export async function getOpenIdConfiguration(
  serviceWorkerGlobalScope: ServiceWorkerGlobalScope,
  discoveryUrl: string,
) {
  // Input validation
  if (!discoveryUrl || typeof discoveryUrl !== 'string') {
    throw new Error('Discovery URL is required and must be a string');
  }

  // Validate URL format and security
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(discoveryUrl);
  } catch {
    throw new Error(`Invalid discovery URL format: ${discoveryUrl}`);
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new Error('Discovery URL must use HTTPS protocol for security');
  }

  // Normalize the discovery URL
  let url = discoveryUrl;
  if (url.indexOf(".well-known/openid-configuration") < 0) {
    if (url.slice(-1) !== "/") {
      url = url + "/";
    }
    url = url + ".well-known/openid-configuration";
  }

  // Check for ongoing request to prevent race conditions
  if (pendingRequests.has(url)) {
    return pendingRequests.get(url);
  }

  const requestPromise = fetchOpenIdConfiguration(serviceWorkerGlobalScope, url);
  pendingRequests.set(url, requestPromise);

  try {
    const result = await requestPromise;
    return result;
  } finally {
    pendingRequests.delete(url);
  }
}

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

  // Check cache first
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

  // Fetch fresh data
  const data = await fetchDiscoveryDocument(serviceWorkerGlobalScope, url);
  
  // Try to cache the result
  try {
    data.timestamp = new Date().getTime();
    await cache.put(url, new Response(JSON.stringify(data)));
  } catch (cacheWriteError) {
    console.warn('[OpenID] Failed to write to cache:', cacheWriteError);
  }

  return data;
}

async function fetchDiscoveryDocument(
  serviceWorkerGlobalScope: ServiceWorkerGlobalScope,
  url: string,
) {
  try {
    // Add timeout to prevent hanging requests
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

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Check content type
    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      throw new Error(`Invalid content type: ${contentType}. Expected application/json`);
    }

    // Check response size to prevent DoS
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
      throw new Error(`Response too large: ${contentLength} bytes. Maximum allowed: ${MAX_RESPONSE_SIZE} bytes`);
    }

    const data = await response.json();
    
    // Validate required OpenID Connect fields
    if (!data.issuer || !data.authorization_endpoint || !data.token_endpoint) {
      throw new Error('Invalid OpenID Connect discovery document: missing required fields');
    }

    return data;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout: Failed to fetch OpenID discovery document from ${url}`);
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch OpenID discovery document from ${url}: ${errorMessage}`);
  }
}

export async function getItemFromOpenIdConfig(
  serviceWorker: ServiceWorkerGlobalScope,
  discoveryUrl: string,
  item: string,
): Promise<string> {
  if (!item || typeof item !== 'string') {
    throw new Error('Item parameter is required and must be a string');
  }

  try {
    const discoverOpenId = await getOpenIdConfiguration(serviceWorker, discoveryUrl);
    
    if (!discoverOpenId || typeof discoverOpenId !== 'object') {
      throw new Error('Invalid OpenID configuration response');
    }

    const value = discoverOpenId[item];
    
    if (value === undefined || value === null) {
      throw new Error(`Required OpenID configuration item '${item}' not found`);
    }

    if (typeof value !== 'string') {
      throw new Error(`OpenID configuration item '${item}' must be a string, got ${typeof value}`);
    }

    return value;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get '${item}' from OpenID configuration: ${errorMessage}`);
  }
}
