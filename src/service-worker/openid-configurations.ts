export async function getOpenIdConfiguration(
  serviceWorkerGlobalScope: ServiceWorkerGlobalScope,
  discoveryUrl: string,
) {
  const cache = await serviceWorkerGlobalScope.caches.open("openIdDiscovery");

  let url = discoveryUrl;
  if (url.indexOf(".well-known/openid-configuration") < 0) {
    if (url.slice(-1) !== "/") {
      url = url + "/";
    }
    url = url + ".well-known/openid-configuration";
  }

  const discoreyResponse = await cache.match(url);
  if (discoreyResponse) {
    const data = await discoreyResponse.json();
    const isExpired = new Date().getTime() - data.timestamp > 1000 * 60 * 60;
    if (data.timestamp && !isExpired) {
      return data;
    }
  }
  const response = await serviceWorkerGlobalScope.fetch(url).catch((e) => e);
  if (response.ok) {
    const data = await response.json();
    data.timestamp = new Date().getTime();
    await cache.put(url, new Response(JSON.stringify(data)));
    return data;
  }
  return Promise.reject(
    new Error(`Failed to fetch OpenID discovery document from ${url}`),
  );
}

export async function getItemFromOpenIdConfig(
  serviceWorker: ServiceWorkerGlobalScope,
  discoveryUrl: string,
  item: string,
): Promise<string> {
  const discoverOpenId = await getOpenIdConfiguration(
    serviceWorker,
    discoveryUrl,
  ).catch((e) => e);
  if (discoverOpenId instanceof Error) {
    return Promise.reject(discoverOpenId);
  } else {
    return discoverOpenId[item];
  }
}
