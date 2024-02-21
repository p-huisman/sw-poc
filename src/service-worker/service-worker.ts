import {P_AUTH_CODE_FLOW} from "../constants";
import {setupDebugConsole} from "./debug-console";
import {getSessionManager} from "./session-manager";

import codeFlowFetchInterceptor from "./code-flow/fetch-interceptor";
import codeFlowLogoffHandler from "./code-flow/logoff-handler";
import authorizationCallbackHandler from "./code-flow/authorization-callback-handler";
import {AuthServiceWorker} from "../interfaces";

export type {};

declare let self: AuthServiceWorker;

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
        eventClient.id,
      );
      await self.sessionManager.removeExpiredSessions();
    }
  };

  switch (event.data.type) {
    case "debug-console":
      self.debugConsole = setupDebugConsole(event.data.debug, "[SW]");
      break;

    case "register-auth-client":
      {
        if (self.registerPromise) {
          await self.registerPromise;
        }
        let resolver: () => void;
        self.registerPromise = new Promise((resolve) => (resolver = resolve));
        await updateSessions();
        const {authClient, session} = event.data;
        const window = eventClient.id;
        await self.sessionManager.addAuthClientSession(
          session,
          window,
          authClient,
        );
        event.ports[0].postMessage({
          type: "register-auth-client",
          success: true,
        });
        resolver();
      }
      break;

    case "logoff":
      await updateSessions();
      handleLogoff(event);
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
    if (
      self.authorizationCallbacksInProgress[0].authClient.type ===
      P_AUTH_CODE_FLOW
    ) {
      await authorizationCallbackHandler(
        self,
        windowClient,
        self.authorizationCallbacksInProgress[0],
      );
      self.authorizationCallbacksInProgress = [];
    } else {
      // other auth types
    }
  }

  const session = windowClient?.id
    ? await self.sessionManager.getSessionForWindow(windowClient.id)
    : null;

  const matchingAuthClientForRequestUrl = session
    ? await self.sessionManager.getAuthClientForRequest(
        event.request.url,
        session,
      )
    : null;

  if (
    matchingAuthClientForRequestUrl &&
    matchingAuthClientForRequestUrl.type === P_AUTH_CODE_FLOW
  ) {
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

async function handleLogoff(event: ExtendableMessageEvent) {
  const currentSession = await self.sessionManager.getSession(
    event.data.session,
  );
  const currentAuthClient = currentSession?.oAuthClients.find(
    (client) => client.id === event.data.client.id,
  );

  if (currentAuthClient && currentAuthClient?.type === P_AUTH_CODE_FLOW) {
    await codeFlowLogoffHandler({
      serviceWorker: self,
      session: currentSession,
      authClient: currentAuthClient,
      event,
    });
  } else {
    const allClients = await self.clients.matchAll({type: "window"});
    const client = allClients.find((client) => client.focused === true);
    event.data.client.callbackPath;
    const location =
      event.data.client.callbackPath +
      "?c=" +
      event.data.client.id +
      "#post_end_session_redirect_uri=" +
      encodeURIComponent(event.data.url.split("#", 1)[0]);

    client.postMessage({
      type: "end-session",
      location,
    });
  }
}
