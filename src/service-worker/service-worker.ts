import {
  AuthClient,
  Config,
  getConfigByClientId,
  getDiscoveryDocumentByClientDiscoveryUrl,
  getNewTokenByClientId,
  getTokenByClientId,
  handleConfigEvent,
  updateConfigMap,
} from "./configs";
import { encodedStringFromObject, generateRandomString, pkceChallengeFromVerifier } from "./pkce";
import { swFetch } from "./sw-fetch";

declare var self: ServiceWorkerGlobalScope;

export type {};

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", async (event) => {
  updateConfigMap();
  let responseResolve: (value: Response | PromiseLike<Response>) => void;
  let responseReject: (reason?: any) => void;

  const responsePromise = new Promise<Response>((resolve, reject) => {
    responseResolve = resolve;
    responseReject = reject;
  });

  const clientId = event.clientId;
  const config = getConfigByClientId(clientId);
  const authClient = matchPatter(event.request.url, config);
  if (authClient) {
    const token = await getTokenByClientId(clientId, authClient.id);
    const response = await swFetch(event.request, token);
    if (response.status === 401) {
      const token = await getNewTokenByClientId(clientId, authClient.id);
      const renewedResponse = await swFetch(event.request, token);
      if (renewedResponse.status === 401) {
        // redirect to login page
        const client = await self.clients.get(clientId);
        if (client) {
          postAtthorizationRequiredMessage(client, config, authClient);
          
        }

      } else {
        responseResolve(renewedResponse);
      }
    } else {
      responseResolve(response);
    }
    event.respondWith(responsePromise);  
  }
});

self.addEventListener("message", (event: ExtendableMessageEvent) => {
  if (event.data && event.data.type === "CONFIG") {
    handleConfigEvent(event);
  }
});

function matchPatter(url: string, config: Config): AuthClient | undefined {
  return config?.authClients.map((client) => {
    const pattern = new RegExp(client.urlPattern);
    return pattern.test(url) ? client : undefined;
  })[0];
}


async function postAtthorizationRequiredMessage(client: Client, config: Config, authClient: AuthClient) {
  // authClient.discoveryUrl
  const discoveryDocument = await getDiscoveryDocumentByClientDiscoveryUrl(authClient.discoveryUrl);

  const verifier = generateRandomString(); 
  const codeChallenge = await pkceChallengeFromVerifier(verifier);

  const authorizationUrl = discoveryDocument.authorization_endpoint + "?" +
              encodedStringFromObject({
                client_id: authClient.clientId,
                code_challenge: codeChallenge,
                code_challenge_method: "S256",
                response_mode: "fragment",
                response_type: "code",
                redirect_uri: self.location.origin + authClient.callbackPath,
                scope: authClient.scope,

              }, encodeURIComponent, "&");


  client.postMessage({
    type: "AUTHORIZATION_REQUIRED",
    verifier,
    authorizationUrl,
  });
}
