import { encodedStringFromObject } from "../helpers/crypto";
import { setupDebugConsole } from "./debug-console";
import {
  AuthClient,
  getSessionManager,
  SessionManager,
} from "./session-manager";

import codeFlowFetchInterceptor from "./fetch-interceptors/code-flow-interceptor";
import codeFlowLogoff from "./logoff-handlers/code-flow-logoff";

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
  registerPromise: Promise<void> | null;
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

self.registerPromise = null;

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
      if (self.registerPromise) {
        await self.registerPromise;
      }

      let resolver: () => void;
      self.registerPromise = new Promise((resolve) => (resolver = resolve));
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
    await self.sessionManager.getAuthClientForRequest(
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

async function handleLogoff(event: ExtendableMessageEvent) {
  const currentSession = await self.sessionManager.getSession(
    event.data.session
  );
  const currentAuthClient = currentSession.oAuthClients.find(
    (client) => client.id === event.data.clientId
  );
  await codeFlowLogoff({
    serviceWorker: self,
    session: currentSession,
    authClient: currentAuthClient,
    event,
  });
}
