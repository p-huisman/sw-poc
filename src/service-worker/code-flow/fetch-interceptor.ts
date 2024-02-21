import {
  encodedStringFromObject,
  generateRandomString,
  pkceChallengeFromVerifier,
} from "../../helpers/crypto";
import {fetchWithAuthorizationHeader} from "../fetch";
import {
  getItemFromOpenIdConfig,
  getOpenIdConfiguration,
} from "../openid-configurations";
import {AuthServiceWorker, AuthClient, Session} from "../../interfaces";

interface InterceptFetchConfig {
  serviceWorker: AuthServiceWorker;
  authClient: AuthClient;
  session: Session;
  event: FetchEvent;
}

interface RefreshConfig {
  serviceWorker: AuthServiceWorker;
  tokenEndpoint: string;
  clientId: string;
  refreshToken: string;
}

export default async (config: InterceptFetchConfig): Promise<Response> => {
  // get token from session manager
  config.serviceWorker.debugConsole.info(
    "fetch interceptor: get token from session manager",
  );
  const tokenData = await getTokenFromSessionManager(config);
  let authorizationHeader: string | null = null;
  let response: Response | null = null;

  if (tokenData) {
    config.serviceWorker.debugConsole.info(
      "fetch interceptor: got token from session manager",
    );
    authorizationHeader = `Bearer ${tokenData.access_token}`;
  } else {
    // no token but is required for request
    config.serviceWorker.debugConsole.info(
      "fetch interceptor: no token but is required for request",
    );
    await postAuthorizationRequiredMessage(
      config.serviceWorker,
      config.event,
      config.authClient,
      config.session,
    );
    return new Promise(() => {}); // return a pending promise to stop the fetch event
  }

  // try fetch with token
  config.serviceWorker.debugConsole.info(
    "fetch interceptor: try fetch with token",
  );
  response = await tryFetch(config, authorizationHeader).catch((e) => e);
  if (response instanceof Error && response.message === "401") {
    // error or token expired
    config.serviceWorker.debugConsole.error(
      `fetch interceptor: request failed (${response.message} ${authorizationHeader}) get token endpoint`,
    );
    // get token endpoint
    const tokenEndpoint = await getItemFromOpenIdConfig(
      config.serviceWorker,
      config.authClient.discoveryUrl,
      "token_endpoint",
    ).catch((e) => e);
    if (tokenEndpoint instanceof Error) {
      config.serviceWorker.debugConsole.error(
        `fetch interceptor: failed to get token endpoint (${tokenEndpoint.message})`,
      );
      return Promise.resolve(response);
    }
    // try fetch with refresh token config
    config.serviceWorker.debugConsole.info(
      `fetch interceptor: request failed (${response.message}) try to refresh token`,
    );
    // refresh token and retry fetch
    response = await tryFetch(config, null, {
      serviceWorker: config.serviceWorker,
      tokenEndpoint,
      clientId: config.authClient.clientId,
      refreshToken: tokenData.refresh_token,
    }).catch((e) => e);

    if (
      (response instanceof Error &&
        response.message === "Failed to refresh token") ||
      response.status === 401
    ) {
      config.serviceWorker.debugConsole.info(
        `fetch interceptor: request with refreshed token failed (${response instanceof Error ? response.message : response.status})`,
      );
      await postAuthorizationRequiredMessage(
        config.serviceWorker,
        config.event,
        config.authClient,
        config.session,
      );
      return new Promise(() => {}); // return a pending promise to stop the fetch event
    }
  }
  return response;
};

// get token from session manager
async function getTokenFromSessionManager(
  config: InterceptFetchConfig,
): Promise<any> {
  config.serviceWorker.debugConsole.info("getTokenFromSessionManager", config);
  const tokenData = await config.serviceWorker.sessionManager.getToken(
    config.session.sessionId,
    config.authClient.id,
  );
  config.serviceWorker.debugConsole.info("tokenData response:", tokenData);
  return tokenData;
}

// try fetch with token, if refesh param is set then try to refresh token before fetching
async function tryFetch(
  config: InterceptFetchConfig,
  token: string,
  refreshParams?: RefreshConfig,
): Promise<Response> {
  let currentToken: string | Error = token;
  config.serviceWorker.debugConsole.info("try to fetch");
  if (refreshParams) {
    config.serviceWorker.debugConsole.info(
      "first get a fresh token:",
      refreshParams,
    );
    const newTokenData = await refreshToken(
      refreshParams.tokenEndpoint,
      refreshParams.clientId,
      refreshParams.refreshToken,
    )
      .then((r) => r.json())
      .catch((e) => e);
    if (newTokenData instanceof Error) {
      config.serviceWorker.debugConsole.error(
        "failed to get a fresh token",
        newTokenData,
      );
      return Promise.reject(new Error("Failed to refresh token"));
    }
    config.serviceWorker.debugConsole.info(
      "got some fresh token data, add token data to session",
      newTokenData,
    );
    await config.serviceWorker.sessionManager.setToken(
      config.session.sessionId,
      config.authClient.id,
      newTokenData,
    );

    sendTokenRefreshMessage(
      config.serviceWorker,
      config.authClient,
      newTokenData,
    );

    currentToken = newTokenData.access_token;
  } else {
    config.serviceWorker.debugConsole.info("try to fetch with token", token);
  }

  const response = await fetchWithAuthorizationHeader(
    config.event.request,
    `${currentToken}`,
  ).catch((e) => e);

  if (response.status === 401) {
    config.serviceWorker.debugConsole.error(
      "fetch with authorization header result in 401",
    );
    return Promise.reject(new Error("401"));
  }
  if (response instanceof Error) {
    config.serviceWorker.debugConsole.error(
      "failed to fetch with authorization header",
      response,
    );
    return Promise.reject(response);
  }
  config.serviceWorker.debugConsole.info(
    "response for fetch with authorization header",
    response,
  );
  return response;
}

async function refreshToken(
  tokenEndpoint: string,
  clientId: string,
  refreshToken: string,
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

async function postAuthorizationRequiredMessage(
  serviceWorker: AuthServiceWorker,
  event: FetchEvent,
  oAuthClient: AuthClient,
  session: Session,
) {
  const serviceWorkerClient = await serviceWorker.clients.get(event.clientId);

  const discoverOpenId = await getOpenIdConfiguration(
    serviceWorker,
    oAuthClient.discoveryUrl,
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
      "&",
    );
  serviceWorker.authorizationCallbacksInProgress.push({
    authClient: oAuthClient,
    data: {
      verifier,
      tokenEndpoint: discoverOpenId.token_endpoint,
      state,
    },
    sessionId: session.sessionId,
  });

  serviceWorkerClient.postMessage({
    type: "authorize",
    client: oAuthClient.id,
    url,
  });
}

function sendTokenRefreshMessage(
  serviceWorker: AuthServiceWorker,
  authClient: AuthClient,
  tokens: any,
) {
  serviceWorker.clients.matchAll().then((clients) => {
    clients.forEach((client) => {
      client.postMessage({
        type: "token-refresh",
        tokens,
        client: authClient.id,
      });
    });
  });
}
