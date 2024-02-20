import {
  encodedStringFromObject,
  generateRandomString,
  pkceChallengeFromVerifier,
} from "../helpers/crypto";
import { setupDebugConsole } from "./debug-console";
import { getOpenIdConfiguration } from "./openid-configurations";
import {
  AuthClient,
  getSessionManager,
  Session,
  SessionManager,
} from "./session-manager";

import codeFlowFetchInterceptor from "./fetch-interceptors/code-flow-interceptor";

export type {};

interface AuthorizationCallbackParam {
  sessionId: string;
  authClient: AuthClient;
  verifier: string;
  tokenEndpoint: string;
  state: any;
}

export interface AuthServiceWorker extends ServiceWorkerGlobalScope {
  sessionManager: SessionManager;
  authorizationCallbacksInProgress: AuthorizationCallbackParam[];
  debugConsole: any;
}

declare var self: AuthServiceWorker;
self.sessionManager = getSessionManager(self);
self.debugConsole = setupDebugConsole(false, "[SW]");
self.authorizationCallbacksInProgress = [];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

let registerPromise: Promise<void> | null = null;

self.addEventListener("message", async (event: ExtendableMessageEvent) => {
  const eventClient = event.source as WindowClient;

  const updateSessions = async () => {
    if (event.data.session) {
      await getSessionManager(self).updateSessionWindow(
        event.data.session,
        eventClient.id
      );
      await self.sessionManager.removeExpiredSessions();
    }
  };

  switch (event.data.type) {
    case "debug-console":
      self.debugConsole = setupDebugConsole(event.data.debug, "[SW]");
      break;

    case "register-auth-client":
      if (registerPromise) {
        await registerPromise;
      }

      let resolver: () => void;
      registerPromise = new Promise((resolve) => (resolver = resolve));
      await updateSessions();

      const { authClient, session } = event.data;
      const window = eventClient.id;
      await self.sessionManager.addAuthClientSession(
        session,
        window,
        authClient
      );
      event.ports[0].postMessage({
        type: "register-auth-client",
        success: true,
      });
      resolver();
      break;

    case "logoff":
      handleLogoff(event);
      await updateSessions();
      break;
  }
});

self.addEventListener("fetch", async (event: FetchEvent) => {
  let responseResolve: (value: Response | PromiseLike<Response>) => void;
  let responseReject: (reason?: any) => void;

  const responsePromise = new Promise<Response>((resolve, reject) => {
    responseResolve = resolve;
    responseReject = reject;
  });

  event.respondWith(responsePromise);

  const windowClient = await getWindowClient(event.clientId);

  if (self.authorizationCallbacksInProgress.length > 0 && windowClient?.url) {
    await handleAuthorizationCallback(
      windowClient,
      self.authorizationCallbacksInProgress[0]
    );
    self.authorizationCallbacksInProgress = [];
  }

  const session = windowClient?.id
    ? await self.sessionManager.getSessionForWindow(windowClient.id)
    : null;

  const matchingAuthClientForRequestUrl =
    await self.sessionManager.getOAuthClientForRequest(
      event.request.url,
      session
    );

  if (matchingAuthClientForRequestUrl) {
    const response = await codeFlowFetchInterceptor({
      event,
      serviceWorker: self,
      session,
      authClient: matchingAuthClientForRequestUrl,
    }).catch((e) => e);
    if (response instanceof Error) {
      responseReject(response);
    } else {
      responseResolve(response);
    }
  } else {
    fetch(event.request)
      .then((fetchResponse) => responseResolve(fetchResponse))
      .catch((e) => responseReject(e));
  }
});

async function fetchFailedAuthorizationRequired(
  event: FetchEvent,
  oAuthClient: AuthClient,
  session: Session
) {
  self.debugConsole.error(
    "no token but is required for request, send authorization required message"
  );
  await postAuthorizationRequiredMessage(event, oAuthClient, session);
}

async function postAuthorizationRequiredMessage(
  event: FetchEvent,
  oAuthClient: AuthClient,
  session: Session
) {
  const serviceWorkerClient = await self.clients.get(event.clientId);
  const discoverOpenId = await getOpenIdConfiguration(
    self,
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
  self.authorizationCallbacksInProgress.push({
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

async function getWindowClient(id: string): Promise<WindowClient> {
  const clients = await self.clients.matchAll();
  return (await clients.find((client) => client?.id === id)) as WindowClient;
}

async function handleAuthorizationCallback(
  windowClient: WindowClient,
  callBack: AuthorizationCallbackParam
) {
  const hash = windowClient.url.split("#", 2)[1];
  const authResponse = getAuthorizationCallbackResponseData(hash);
  const body = encodedStringFromObject({
    client_id: callBack.authClient.clientId,
    code: authResponse.code,
    code_verifier: callBack.verifier,
    grant_type: "authorization_code",
    redirect_uri: self.location.origin + callBack.authClient.callbackPath,
  });

  const tokenResponse = await fetch(callBack.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
  })
    .then((response) => response.json())
    .catch((e) => e);
  if (tokenResponse instanceof Error) {
    throw tokenResponse;
  } else {
    self.sessionManager
      .setToken(callBack.sessionId, callBack.authClient.id, tokenResponse)
      .then(() => {
        windowClient.postMessage({
          type: "authorization-complete",
          tokens: tokenResponse,
          client: callBack.authClient.id,
          location: callBack.state.location,
        });
      });
  }
}

async function refreshtTokens(
  tokenEndpoint: string,
  clientId: string,
  refreshToken: string
): Promise<Response> {
  const body = encodedStringFromObject({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  return fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
  });
}

function getAuthorizationCallbackResponseData(queryString: string): any {
  if (queryString.indexOf("error=") > -1) {
    return new Error(queryString); // todo get error from query string
  }
  return queryString.split("&").reduce((result: any, item: any) => {
    const parts = item.split("=");
    result[parts[0]] = decodeURIComponent(parts[1]);
    return result;
  }, {});
}

function revokeTokens(tokenEndpoint: string, clientId: string, tokens: any) {
  const revokePromises: Promise<Response>[] = [];
  [
    ["access_token", tokens.access_token],
    ["refresh_token", tokens.refresh_token],
  ].forEach((token) => {
    if (token) {
      revokePromises.push(
        revokeToken(tokenEndpoint, clientId, token[0], token[1])
      );
    }
  });
  return Promise.all(revokePromises);
}

function revokeToken(
  tokenEndpoint: string,
  clientId: string,
  tokenType: string,
  token: string
) {
  const body = encodedStringFromObject({
    client_id: clientId,
    token,
    token_type_hint: tokenType,
  });
  return fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
  });
}

async function handleLogoff(event: ExtendableMessageEvent) {
  const window = (event.source as WindowClient).id;
  const currentSession = await self.sessionManager.getSession(
    event.data.session
  );
  const currentAuthClient = currentSession.oAuthClients.find(
    (client) => client.id === event.data.clientId
  );
  
  const tokenData = await self.sessionManager.getToken(
    event.data.session,
    currentAuthClient.id
  );
  if (currentSession && tokenData) {
    const discoverOpenId = await getOpenIdConfiguration(
      self,
      currentAuthClient.discoveryUrl
    );
    await revokeTokens(
      discoverOpenId.revocation_endpoint,
      currentAuthClient.clientId,
      tokenData
    );
    const serviceWorkerClient = await self.clients.get(window);
    const currentUrl = new URL(serviceWorkerClient.url);

    const params =
      "?" +
      encodedStringFromObject(
        {
          id_token_hint: tokenData.id_token,
          post_logout_redirect_uri:
            currentUrl.origin +
            currentAuthClient.callbackPath +
            "#post_end_session_redirect_uri=" +
            encodeURIComponent(event.data.url),
        },
        encodeURIComponent,
        "&"
      );
    await self.sessionManager.removeToken(
      event.data.session,
      currentAuthClient.id
    );

    serviceWorkerClient.postMessage({
      type: "end-session",
      location: discoverOpenId.end_session_endpoint + params,
    });
  }
}
