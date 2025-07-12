import {P_AUTH_CODE_FLOW} from "../constants";
import {setupDebugConsole} from "./debug-console";
import {getSessionManager} from "./session-manager";

import codeFlowFetchInterceptor from "./code-flow/fetch-interceptor";
import codeFlowLogoffHandler from "./code-flow/logoff-handler";
import codeFlowUserinfoHandler from "./code-flow/userinfo-handler";
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

  // Add input validation
  if (!event.data || typeof event.data.type !== 'string') {
    console.warn('[SW] Invalid message data received:', event.data);
    return;
  }

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

    case "userinfo":
      {
        // Validate required fields and port availability
        if (!event.ports[0] || !event.data.authClient || !event.data.session) {
          console.warn('[SW] Invalid userinfo request - missing required fields');
          return;
        }

        if (event.data.authClient.type === P_AUTH_CODE_FLOW) {
          try {
            const userinfo = await codeFlowUserinfoHandler({
              serviceWorker: self,
              authClient: event.data.authClient,
              session: event.data.session,
              event,
            });
            event.ports[0].postMessage({
              type: "userinfo",
              userinfo,
              error: null,
            });
          } catch (error) {
            event.ports[0].postMessage({
              type: "userinfo",
              userinfo: null,
              error: error instanceof Error ? error : new Error(String(error)),
            });
          }
        } else {
          // other auth types
        }
      }
      break;

    case "register-auth-client":
      {
        // Validate required fields and port availability
        if (!event.ports[0] || !event.data.authClient || !event.data.session) {
          console.warn('[SW] Invalid register-auth-client request - missing required fields');
          return;
        }

        try {
          if (self.registerPromise) {
            await self.registerPromise;
          }
          
          // Use a more robust promise pattern
          let resolver: () => void;
          self.registerPromise = new Promise<void>((resolve) => {
            resolver = resolve;
          });
          
          await updateSessions();
          const { authClient, session }: { authClient: any; session: string } = event.data;
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
        } catch (error) {
          self.debugConsole?.error('Failed to register auth client:', error);
          event.ports[0].postMessage({
            type: "register-auth-client",
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
          // Reset the register promise on failure
          self.registerPromise = null;
        }
      }
      break;

    case "logoff":
      await updateSessions();
      handleLogoff(event);
      break;
  }
});

self.addEventListener("fetch", async (event: FetchEvent) => {
  const startTime = performance.now();
  let responseResolve: (value: Response | PromiseLike<Response>) => void;
  let responseReject: (reason?: any) => void;

  const responsePromise = new Promise<Response>((resolve, reject) => {
    responseResolve = (response) => {
      const duration = performance.now() - startTime;
      self.debugConsole?.info(`Fetch completed in ${duration.toFixed(2)}ms for ${event.request.url}`);
      resolve(response);
    };
    responseReject = (error) => {
      const duration = performance.now() - startTime;
      self.debugConsole?.error(`Fetch failed after ${duration.toFixed(2)}ms for ${event.request.url}:`, error);
      reject(error);
    };
  });

  event.respondWith(responsePromise);

  const windowClient = await getWindowClient(event.clientId);

  if (self.authorizationCallbacksInProgress.length > 0 && windowClient?.url) {
    if (
      self.authorizationCallbacksInProgress[0].authClient.type ===
      P_AUTH_CODE_FLOW
    ) {
      try {
        await authorizationCallbackHandler(
          self,
          windowClient,
          self.authorizationCallbacksInProgress[0],
        );
      } catch (error) {
        self.debugConsole?.error('Authorization callback handler failed:', error);
      } finally {
        self.authorizationCallbacksInProgress = [];
      }
    } else {
      // other auth types
      self.authorizationCallbacksInProgress = [];
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
    try {
      const response = await codeFlowFetchInterceptor({
        event,
        serviceWorker: self,
        session,
        authClient: matchingAuthClientForRequestUrl,
      });
      responseResolve(response);
    } catch (error) {
      responseReject(error);
    }
  } else {
    // Add timeout to prevent hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    fetch(event.request, { signal: controller.signal })
      .then((fetchResponse) => {
        clearTimeout(timeoutId);
        responseResolve(fetchResponse);
      })
      .catch((e) => {
        clearTimeout(timeoutId);
        responseReject(e);
      });
  }
});

async function getWindowClient(id: string | null): Promise<WindowClient | null> {
  if (!id) return null;
  
  try {
    const clients = await self.clients.matchAll();
    return clients.find((client) => client?.id === id) as WindowClient || null;
  } catch (error) {
    self.debugConsole?.error('Failed to get window client:', error);
    return null;
  }
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
    
    if (!client) {
      console.warn('[SW] No focused client found for end-session redirect');
      return;
    }

    // Remove unused line and add proper validation
    if (!event.data.client?.callbackPath || !event.data.url) {
      console.warn('[SW] Missing required data for end-session redirect');
      return;
    }

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
