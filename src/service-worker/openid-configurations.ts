export interface ConfigurationReponse {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  token_endpoint_auth_methods_supported: string[];
  token_endpoint_auth_signing_alg_values_supported: string[];
  userinfo_endpoint: string;
  check_session_iframe: string;
  end_session_endpoint: string;
  registration_endpoint: string;
  scopes_supported: string[];
  response_types_supported: string[];
  acr_values_supported: string[];
  subject_types_supported: string[];
  userinfo_signing_alg_values_supported: string;
  userinfo_encryption_alg_values_supported: string[];
  userinfo_encryption_enc_values_supported: string[];
  id_token_signing_alg_values_supported: string[];
  id_token_encryption_alg_values_supported: string;
  id_token_encryption_enc_values_supported: string[];
  request_object_signing_alg_values_supported: string[];
  display_values_supported: string[];
  claim_types_supported: string[];
  claims_supported: string[];
  claims_parameter_supported: boolean;
  service_documentation: string;
  ui_locales_supported?: string[];
  _timestamp?: number;
}

export async function getOpenIdConfiguration(
  serviceWorkerGlobalScope: ServiceWorkerGlobalScope,
  discoveryUrl: string,
): Promise<ConfigurationReponse> {
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
    const isExpired = new Date().getTime() - data._timestamp > 1000 * 60 * 60;
    if (data._timestamp && !isExpired) {
      return data;
    }
  }
  const response = await serviceWorkerGlobalScope.fetch(url).catch((e) => e);
  if (response.ok) {
    const data = (await response.json()) as ConfigurationReponse;
    data._timestamp = new Date().getTime();
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
