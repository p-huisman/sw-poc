import {
  decodeToken,
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

interface InterceptFetchOptions {
  serviceWorker: AuthServiceWorker;
  authClient: AuthClient;
  session: Session;
  event: FetchEvent;
}

interface RefreshOptions {
  serviceWorker: AuthServiceWorker;
  tokenEndpoint: string;
  clientId: string;
  refreshToken: string;
}

export default async (options: InterceptFetchOptions): Promise<Response> => {
  // get token from session manager
  options.serviceWorker.debugConsole.info(
    "fetch interceptor: get token from session manager",
  );
  const tokenData = await getTokenFromSessionManager(options);
  let authorizationHeader: string | null = null;
  let response: Response | null = null;

  if (!tokenData) {
    // no token but is required for request
    options.serviceWorker.debugConsole.info(
      "fetch interceptor: no token but is required for request",
    );
    // try without a token
    const response = await fetchWithAuthorizationHeader(
      options.event.request,
      null,
    ).catch((e) => e);
    if (response.status !== 401) {
      if (response instanceof Error) {
        options.serviceWorker.debugConsole.error(
          "fetch interceptor: request failed",
          response,
        );
        return Promise.reject(response);
      }
      return Promise.resolve(response);
    }
    // do authorization required message without prompt and if it fails do it with prompt
    authorizationHeader = await getAuthorizationHeaderUsingSilentRenew(options);
    if (!authorizationHeader) {
      return new Promise(() => {}); // return a pending promise to stop the fetch event
    }
  } else {
    console.log(decodeToken(tokenData.id_token));
    options.serviceWorker.debugConsole.info(
      "fetch interceptor: got token from session manager",
    );
    authorizationHeader = `Bearer ${tokenData.access_token}`;
  }

  // We got a token maybe expired, try to fetch with it
  options.serviceWorker.debugConsole.info(
    "fetch interceptor: try fetch with token",
  );
  response = await tryFetch(options, authorizationHeader).catch((e) => e);
  handleFetchAttempt(options, authorizationHeader, tokenData, response);
  return response;
};

async function handleFetchAttempt(
  options: InterceptFetchOptions,
  authorizationHeader: string,
  tokenData: any,
  response: Response,
) {
  if (response instanceof Error && response.message === "401") {
    // error or token expired
    options.serviceWorker.debugConsole.error(
      `fetch interceptor: request failed (${response.message} ${authorizationHeader}) get token endpoint`,
    );
    // get token endpoint
    const tokenEndpoint = await getItemFromOpenIdConfig(
      options.serviceWorker,
      options.authClient.discoveryUrl,
      "token_endpoint",
    ).catch((e) => e);
    if (tokenEndpoint instanceof Error) {
      options.serviceWorker.debugConsole.error(
        `fetch interceptor: failed to get token endpoint (${tokenEndpoint.message})`,
      );
      return Promise.resolve(response);
    }
    // try fetch with refresh token config
    options.serviceWorker.debugConsole.info(
      `fetch interceptor: request failed (${response.message}) try to refresh token`,
    );
    // refresh token and retry fetch
    response = await tryFetch(options, null, {
      serviceWorker: options.serviceWorker,
      tokenEndpoint,
      clientId: options.authClient.clientId,
      refreshToken: tokenData.refresh_token,
    }).catch((e) => e);

    if (
      (response instanceof Error &&
        response.message === "Failed to refresh token") ||
      response.status === 401
    ) {
      options.serviceWorker.debugConsole.info(
        `fetch interceptor: request with refreshed token failed (${response instanceof Error ? response.message : response.status})`,
      );

      authorizationHeader =
        await getAuthorizationHeaderUsingSilentRenew(options);
      if (!authorizationHeader) {
        return new Promise(() => {}); // return a pending promise to stop the fetch event
      }
      response = await tryFetch(options, authorizationHeader).catch((e) => e);
    }
  }
  return response;
}

async function getAuthorizationHeaderUsingSilentRenew(
  options: InterceptFetchOptions,
): Promise<string> {
  // do authorization required message without prompt (in iframe)
  const silentRenew = await postAuthorizationRequiredMessage(
    options.serviceWorker,
    options.event,
    options.authClient,
    options.session,
    true,
  ).catch((e) => e);
  // authorization required message if we don't have a token or if silent renew failed
  const tokenData = await getTokenFromSessionManager(options);
  const authorizationHeader = tokenData?.access_token
    ? `Bearer ${tokenData.access_token}`
    : null;

  if (silentRenew instanceof Error || !tokenData?.access_token) {
    await postAuthorizationRequiredMessage(
      options.serviceWorker,
      options.event,
      options.authClient,
      options.session,
    );
    return null;
  } else {
    return authorizationHeader;
  }
}

// get token from session manager
async function getTokenFromSessionManager(
  options: InterceptFetchOptions,
): Promise<any> {
  options.serviceWorker.debugConsole.info(
    "getTokenFromSessionManager",
    options,
  );
  const tokenData = await options.serviceWorker.sessionManager.getToken(
    options.session.sessionId,
    options.authClient.id,
  );
  options.serviceWorker.debugConsole.info("tokenData response:", tokenData);
  return tokenData;
}

// try fetch with token, if refesh param is set then try to refresh token before fetching
// eslint-disable-next-line sonarjs/cognitive-complexity
async function tryFetch(
  options: InterceptFetchOptions,
  token: string,
  refreshOptions?: RefreshOptions,
): Promise<Response> {
  let currentToken: string | Error = token;
  options.serviceWorker.debugConsole.info("try to fetch");
  if (refreshOptions) {
    options.serviceWorker.debugConsole.info(
      "first get a fresh token:",
      refreshOptions,
    );
    const newTokenData = await refreshToken(
      refreshOptions.tokenEndpoint,
      refreshOptions.clientId,
      refreshOptions.refreshToken,
    )
      .then((r) => r.json())
      .catch((e) => e);
    if (newTokenData instanceof Error) {
      options.serviceWorker.debugConsole.error(
        "failed to get a fresh token",
        newTokenData,
      );
      return Promise.reject(new Error("Failed to refresh token"));
    }
    options.serviceWorker.debugConsole.info(
      "got some fresh token data, add token data to session",
      newTokenData,
    );
    await options.serviceWorker.sessionManager.setToken(
      options.session.sessionId,
      options.authClient.id,
      newTokenData,
    );

    postTokenRefreshMessage(
      options.serviceWorker,
      options.authClient,
      newTokenData,
    );

    currentToken = newTokenData.access_token;
  } else {
    options.serviceWorker.debugConsole.info("try to fetch with token", token);
  }

  const response = await fetchWithAuthorizationHeader(
    options.event.request,
    `${currentToken}`,
  ).catch((e) => e);

  if (response.status === 401) {
    options.serviceWorker.debugConsole.error(
      "fetch with authorization header result in 401",
    );

    const silentRenew = await postAuthorizationRequiredMessage(
      options.serviceWorker,
      options.event,
      options.authClient,
      options.session,
      true,
    ).catch((e) => e);
    // authorization required message if we don't have a token or if silent renew failed
    const tokenData = await getTokenFromSessionManager(options);
    if (silentRenew instanceof Error || !tokenData?.access_token) {
      // post authorization required message
      postAuthorizationRequiredMessage(
        options.serviceWorker,
        options.event,
        options.authClient,
        options.session,
      );
      return new Promise(() => {}); // return a pending promise to stop the fetch event
    } else {
      const response = await fetchWithAuthorizationHeader(
        options.event.request,
        `Bearer ${tokenData.access_token}`,
      ).catch((e) => e);
      if (response.status === 401) {
        postAuthorizationRequiredMessage(
          options.serviceWorker,
          options.event,
          options.authClient,
          options.session,
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
    options.serviceWorker.debugConsole.error(
      "failed to fetch with authorization header",
      response,
    );
    return Promise.reject(response);
  }
  options.serviceWorker.debugConsole.info(
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

export async function postAuthorizationRequiredMessage(
  serviceWorker: AuthServiceWorker,
  event: FetchEvent | ExtendableMessageEvent,
  oAuthClient: AuthClient,
  session: Session,
  silent = false,
): Promise<void | TokenData> {
  let serviceWorkerClient;
  if (event instanceof ExtendableMessageEvent) {
    serviceWorkerClient = event.source as Client;
  } else {
    serviceWorkerClient = await serviceWorker.clients.get(event.clientId);
  }

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

function postTokenRefreshMessage(
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
