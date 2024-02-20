import { encodedStringFromObject, generateRandomString, pkceChallengeFromVerifier } from "../../helpers/crypto";
import { fetchWithAuthorizationHeader } from "../fetch";
import { getOpenIdConfiguration } from "../openid-configurations";
import { AuthServiceWorker } from "../service-worker";
import { AuthClient, Session, SessionManager, TokenData } from "../session-manager";

interface InterceptFetchConfig {
  serviceWorker: AuthServiceWorker;
  authClient: AuthClient;
  sessionId: string;
  request: Request;
}

export default async (config: InterceptFetchConfig): Promise<Response> => {
  const tokenData = await getToken(config);
  let authorizationHeader: string | null = null;
  let response: Response | null = null;
  if (tokenData) {
    authorizationHeader = `Bearer ${tokenData.tokens.access_token}`;
  } else {
    return Promise.reject(new Error("No token data"));
  }

  response = await tryFetchWithToken(config, authorizationHeader).catch(
    (e) => e
  );
  if (response instanceof Error && response.message === "401") {
    //
  }
  return response;
};

async function getToken(config: InterceptFetchConfig): Promise<TokenData> {
  return await config.serviceWorker.sessionManager.getToken(
    config.sessionId,
    config.authClient.id
  );
}

async function tryFetchWithToken(
  config: InterceptFetchConfig,
  token: string
): Promise<Response> {
  const response = await fetchWithAuthorizationHeader(
    config.request,
    `Bearer {token}`
  ).catch((e) => e);
  if (response.status === 401) {
    return Promise.reject(new Error("401"));
  }
  if (response instanceof Error) {
    return Promise.reject(response);
  }
  return response;
}



async function refreshToken(
  tokenEndpoint: string,
  clientId: string,
  refreshToken: string
): Promise<Response> {
  const body = encodedStringFromObject({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const tokenData = fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
  }).catch((e) => e);
  if (tokenData instanceof Error) {
    return Promise.reject(tokenData);
  }
  return tokenData;
}

async function fetchFailedAuthorizationRequired(serviceWorker: AuthServiceWorker, event: FetchEvent, oAuthClient: AuthClient, session: Session) {
  serviceWorker.debugConsole.error(
    "no token but is required for request, send authorization required message"
  );
  await postAuthorizationRequiredMessage(
    serviceWorker,
    event,
    oAuthClient,
    session
  );
}

async function postAuthorizationRequiredMessage(
  serviceWorker: AuthServiceWorker, 
  event: FetchEvent,
  oAuthClient: AuthClient,
  session: Session
) {
  const serviceWorkerClient = await serviceWorker.clients.get(event.clientId);
  const discoverOpenId = await getOpenIdConfiguration(
    serviceWorker,
    oAuthClient.discoveryUrl
  );

  const verifier = generateRandomString();
  const codeChallenge = await pkceChallengeFromVerifier(verifier);
  const currentUrl = new URL(serviceWorkerClient.url);
  const state = {
    location: serviceWorkerClient.url.replace(currentUrl.origin, ""),
  };
  const url =
    discoverOpenId.authorization_endpoint +
    "?" +
    encodedStringFromObject(
      {
        client_id: oAuthClient.clientId,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        response_mode: "fragment",
        response_type: "code",
        redirect_uri: self.location.origin + oAuthClient.callbackPath,
        scope: oAuthClient.scope,
        state: JSON.stringify(state),
      },
      encodeURIComponent,
      "&"
    );
    serviceWorker.authorizationCallbacksInProgress.push({
    sessionId: session.sessionId,
    verifier,
    tokenEndpoint: discoverOpenId.token_endpoint,
    authClient: oAuthClient,
    state,
  });

  serviceWorkerClient.postMessage({
    type: "authorize",
    client: oAuthClient.id,
    url,
  });
}
