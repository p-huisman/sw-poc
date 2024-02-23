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
import {
  AuthServiceWorker,
  AuthClient,
  Session,
  TokenData,
} from "../../interfaces";

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

// eslint-disable-next-line sonarjs/cognitive-complexity
export default async (config: InterceptFetchConfig): Promise<Response> => {
  // get token from session manager
  config.serviceWorker.debugConsole.info(
    "fetch interceptor: get token from session manager",
  );
  let tokenData = await getTokenFromSessionManager(config);
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

    // try first with token, if it fails then post authorization required message
    const response = await fetchWithAuthorizationHeader(
      config.event.request,
    ).catch((e) => e);
    if (response.status !== 401) {
      if (response instanceof Error) {
        config.serviceWorker.debugConsole.error(
          "fetch interceptor: request failed",
          response,
        );
        return Promise.reject(response);
      }
      return Promise.resolve(response);
    }

    // do authorization required message without prompt (in iframe)
    const silentRenew = await postAuthorizationRequiredMessage(
      config.serviceWorker,
      config.event,
      config.authClient,
      config.session,
      true,
    ).catch((e) => e);
    // authorization required message if we don't have a token or if silent renew failed
    tokenData = await getTokenFromSessionManager(config);
    if (silentRenew instanceof Error || !tokenData?.access_token) {
      // silent renew failed, do normal renew
      postAuthorizationRequiredMessage(
        config.serviceWorker,
        config.event,
        config.authClient,
        config.session,
      );
      return new Promise(() => {}); // return a pending promise to stop the fetch event
    }
    authorizationHeader = `Bearer ${tokenData.access_token}`;
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

      // do authorization required message without prompt (in iframe)
      const silentRenew = await postAuthorizationRequiredMessage(
        config.serviceWorker,
        config.event,
        config.authClient,
        config.session,
        true,
      ).catch((e) => e);
      // authorization required message if we don't have a token or if silent renew failed
      tokenData = await getTokenFromSessionManager(config);
      authorizationHeader = `Bearer ${tokenData.access_token}`;

      if (silentRenew instanceof Error || !tokenData?.access_token) {
        await postAuthorizationRequiredMessage(
          config.serviceWorker,
          config.event,
          config.authClient,
          config.session,
        );
        return new Promise(() => {}); // return a pending promise to stop the fetch event
      }
      response = await tryFetch(config, authorizationHeader).catch((e) => e);
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
// eslint-disable-next-line sonarjs/cognitive-complexity
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

    const silentRenew = await postAuthorizationRequiredMessage(
      config.serviceWorker,
      config.event,
      config.authClient,
      config.session,
      true,
    ).catch((e) => e);
    // authorization required message if we don't have a token or if silent renew failed
    const tokenData = await getTokenFromSessionManager(config);
    if (silentRenew instanceof Error || !tokenData?.access_token) {
      // post authorization required message
      postAuthorizationRequiredMessage(
        config.serviceWorker,
        config.event,
        config.authClient,
        config.session,
      );
      return new Promise(() => {}); // return a pending promise to stop the fetch event
    } else {
      const response = await fetchWithAuthorizationHeader(
        config.event.request,
        `Bearer ${tokenData.access_token}`,
      ).catch((e) => e);
      if (response.status === 401) {
        postAuthorizationRequiredMessage(
          config.serviceWorker,
          config.event,
          config.authClient,
          config.session,
        );
        return new Promise(() => {});
      }
      if (response instanceof Error) {
        return Promise.reject(response);
      }
      return response;
    }
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
  silent = false,
): Promise<void | TokenData> {
  const serviceWorkerClient = await serviceWorker.clients.get(event.clientId);

  const discoverOpenId = await getOpenIdConfiguration(
    serviceWorker,
    oAuthClient.discoveryUrl,
  );

  const verifier = generateRandomString();
  const codeChallenge = await pkceChallengeFromVerifier(verifier);
  const currentUrl = new URL(serviceWorkerClient.url);
  const state: any = {
    location: serviceWorkerClient.url.replace(currentUrl.origin, ""),
  };

  if (silent) {
    state.silent = silent;
  }

  const tokenLocationParams: any = {
    client_id: oAuthClient.clientId,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    response_mode: "fragment",
    response_type: "code",
    redirect_uri: self.location.origin + oAuthClient.callbackPath,
    scope: oAuthClient.scope,
    state: JSON.stringify(state),
  };
  if (silent) {
    tokenLocationParams.prompt = "none";
  }

  const url =
    discoverOpenId.authorization_endpoint +
    "?" +
    encodedStringFromObject(tokenLocationParams, encodeURIComponent, "&");
  serviceWorker.authorizationCallbacksInProgress.push({
    authClient: oAuthClient,
    data: {
      verifier,
      tokenEndpoint: discoverOpenId.token_endpoint,
      state,
    },
    sessionId: session.sessionId,
  });
  if (silent) {
    return postSilentRenewMessage(serviceWorkerClient, oAuthClient.id, url);
  }
  serviceWorkerClient.postMessage({
    type: "authorize",
    client: oAuthClient.id,
    url,
  });
}

async function postSilentRenewMessage(
  serviceWorkerClient: Client,
  oAuthClientId: string,
  url: string,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const messageChannel = new MessageChannel();
    messageChannel.port1.onmessage = (event) => {
      if (event.data.error) {
        reject(event.data.error);
      } else {
        resolve(event.data);
      }
    };
    serviceWorkerClient.postMessage(
      {
        type: "authorize",
        client: oAuthClientId,
        url,
        silent: true,
      },
      [messageChannel.port2],
    );
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
