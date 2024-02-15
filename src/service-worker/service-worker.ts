import {
  AuthClient,
  Config,
  Tokens,
  getConfigByClientId,
  getDiscoveryDocumentByClientDiscoveryUrl,
  getNewTokenBySessionId,
  getTokensBySessionId,
  handleConfigEvent,
  setTokenBySessionId,
  updateConfig,
  updateConfigMap,
} from "./configs";
import {
  encodedStringFromObject,
  generateRandomString,
  pkceChallengeFromVerifier,
} from "./pkce";
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
    const tokens: Tokens = await getTokensBySessionId(config.session, authClient.id);
    const response = await swFetch(event.request, tokens?.access_token);
    if (response.status === 401) {
      const tokens : Tokens = await getNewTokenBySessionId(config.session, authClient.id);
      // todo
      const renewedResponse = await swFetch(event.request, tokens?.access_token);
      if (renewedResponse.status === 401) {
        // redirect to login page
        const client = await self.clients.get(clientId);
        if (client) {
          postAtthorizationRequiredMessage(client, authClient);
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

self.addEventListener("message", async (event: ExtendableMessageEvent) => {
  if (event.data && event.data.type === "CONFIG") {
    handleConfigEvent(event);
  } else if (event.data && event.data.type === "AUTHORIZATION_RESPONSE") {
    const eventClient = event.source as Client;
    await updateConfig(eventClient.id, {
      authClients: event.data.authClients,
      session: event.data.session,
    });
    const { verifier, clientId } = event.data;
    const config = getConfigByClientId(eventClient.id);
    const authClient = config.authClients.find(
      (client) => client.id === clientId
    );
    
    const authResponse = getAuthorizationResponse(eventClient.url.split("#", 2)[1]);
    
    if (authResponse instanceof Error) {
      // todo handle error
    }
    const discoveryDocument = await getDiscoveryDocumentByClientDiscoveryUrl(
      authClient.discoveryUrl
    );

    const body = encodedStringFromObject({
      client_id: authClient.clientId,
      code: authResponse.code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: self.location.origin + authClient.callbackPath,
    });

    const tokenResponse = await fetch(discoveryDocument.token_endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body,
    })
      .then((response) => response.json())
      .catch((e) => e);
    if (tokenResponse instanceof Error) {
    } else {
      setTokenBySessionId( config.session, authClient.id, tokenResponse);
    }
    console.log({ tokenResponse, authResponse });
  }
});

function matchPatter(url: string, config: Config): AuthClient | undefined {
  return config?.authClients.map((client) => {
    const pattern = new RegExp(client.urlPattern);
    return pattern.test(url) ? client : undefined;
  })[0];
}

async function postAtthorizationRequiredMessage(
  client: Client,
  authClient: AuthClient
) {
  const discoveryDocument = await getDiscoveryDocumentByClientDiscoveryUrl(
    authClient.discoveryUrl
  );
  const verifier = generateRandomString();
  const codeChallenge = await pkceChallengeFromVerifier(verifier);
  const authorizationUrl =
    discoveryDocument.authorization_endpoint +
    "?" +
    encodedStringFromObject(
      {
        client_id: authClient.clientId,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        response_mode: "fragment",
        response_type: "code",
        redirect_uri: self.location.origin + authClient.callbackPath,
        scope: authClient.scope,
      },
      encodeURIComponent,
      "&"
    );

  client.postMessage({
    type: "AUTHORIZATION_REQUIRED",
    verifier,
    authorizationUrl,
    clientId: authClient.id,
  });
}

function getAuthorizationResponse(queryString: string): any {
  if (queryString.indexOf("error=") > -1) {
    return new Error(queryString); // todo get error from query string
  }
  return queryString.split("&").reduce((result: any, item: any) => {
    const parts = item.split("=");
    result[parts[0]] = decodeURIComponent(parts[1]);
    return result;
  }, {});
}
