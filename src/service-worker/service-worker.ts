import {
  encodedStringFromObject,
  generateRandomString,
  pkceChallengeFromVerifier,
} from "../helpers/crypto";
import { setupDebugConsole } from "./debug-console";
import { fetchWithToken } from "./fetch";
import { getOpenIdConfiguration } from "./openid-configurations";
import { AuthClient, getSessionManager, Session } from "./session-manager";

export type {};

interface AuthorizationCallbackParam {
  sessionId: string;
  oAuthClient: AuthClient;
  verifier: string;
  tokenEndpoint: string;
  state: any;
}

declare var self: ServiceWorkerGlobalScope;
const sessionManager = getSessionManager(self);
const tokens = new Map<string, any>();
let debugConsole = setupDebugConsole(false, "[SW]");
let authorizationCallbacksInProgress: AuthorizationCallbackParam[] = [];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", async (event: ExtendableMessageEvent) => {
  const eventClient = event.source as WindowClient;
  
  switch (event.data.type) {
    case "debug-console":
      debugConsole = setupDebugConsole(event.data.debug, "[SW]");
      break;
    
    case "register-auth-client":
      
      // add or update session
      const { authClient, session } = event.data;

      const window = eventClient.id
      await sessionManager.addAuthClientSession(
        session,
        window,
        authClient
      );

      await sessionManager.removeExpiredSessions();

      event.ports[0].postMessage({
        type: "register-auth-client",
        success: true,
      });
      break;
   
    case "logoff":
      const tokenData = tokens.get(
        `${event.data.session}_${event.data.clientId}`
      );
      const currentSession = await sessionManager.getSession(event.data.session);
      const currentAuthClient = currentSession.oAuthClients.find(client => client.id === event.data.clientId);

      if (currentSession && tokenData) {
        const discoverOpenId = await getOpenIdConfiguration(self,
          currentAuthClient.config.discoveryUrl
        );
        await revokeTokens(
          discoverOpenId.revocation_endpoint,
          currentAuthClient.config.clientId,
          tokenData
        );
        const swClient = await self.clients.get(eventClient.id); 
        const currentUrl = new URL(swClient.url);
       
        const params = "?" +
        encodedStringFromObject(
          {
            id_token_hint: tokenData.id_token,
            post_logout_redirect_uri:
            currentUrl.origin +
            currentAuthClient.config.callbackPath + "#post_end_session_redirect_uri=" + encodeURIComponent(event.data.url),
          },
          encodeURIComponent,
          "&",
        )
        tokens.delete(`${event.data.session}_${event.data.clientId}`);      
       
        swClient.postMessage({
          type: "end-session",
          location: discoverOpenId.end_session_endpoint + params,
        });
        
      }
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

  if (authorizationCallbacksInProgress.length > 0 && windowClient?.url) {
    handleAuthorizationCallback(windowClient, authorizationCallbacksInProgress[0]);
    authorizationCallbacksInProgress = [];
  }
  
  const session = windowClient?.id ? await sessionManager.getSessionForWindow(windowClient.id) : null;
  
  const oAuthClientForRequest = await sessionManager.getOAuthClientForRequest(
    event.request.url,
    session
  );

  
  if (oAuthClientForRequest) {
    let tokenData = tokens.get(`${session.sessionId}_${oAuthClientForRequest.config.clientId}`);
    const discoverOpenId = await getOpenIdConfiguration(self,
      oAuthClientForRequest.config.discoveryUrl
    );
    if (tokenData) {
      debugConsole.info("fetch with token", tokenData.access_token);
      fetchWithToken(event.request, tokenData.access_token)
        .then((fetchResponse) => {
          if (fetchResponse.status === 401) {
            debugConsole.info(
              "401 on fetch with token, trying to refresh token"
            );
            refreshtTokens(
              discoverOpenId.token_endpoint,
              oAuthClientForRequest.config.clientId,
              tokenData.refresh_token
            )
              .then((response) => {
                if (response.ok) {
                  debugConsole.info("token refreshed");
                  response.json().then((newTokenData) => {
                    tokens.set(
                      `${session.sessionId}_${oAuthClientForRequest.config.clientId}`,
                      newTokenData
                    );
                    debugConsole.table(tokens);
                    debugConsole.info(
                      "fetch with new token",
                      newTokenData.access_token
                    );
                    fetchWithToken(event.request, newTokenData.access_token)
                      .then((fetchResponse) => {
                        if (fetchResponse.status === 401) {
                          debugConsole.info(
                            "401 on fetch with new token, send authorization required message"
                          );
                          postAthorizationRequiredMessage(event, oAuthClientForRequest, session);
                        } else {
                          debugConsole.info("fetch with new token success");
                          responseResolve(fetchResponse);
                        }
                      })
                      .catch((e) => {
                        debugConsole.error("fetch with new token error", e);
                        responseReject(e);
                      });
                  });
                } else {
                  debugConsole.error(
                    "refreshing token response not ok",
                    response.status,
                    response
                  );
                  postAthorizationRequiredMessage(event, oAuthClientForRequest, session);
                }
              })
              .catch((e) => {
                debugConsole.error("error refreshing token response not ok", e);
                responseReject(e);
              });
          } else {
            debugConsole.info("fetch with token success");
            responseResolve(fetchResponse);
          }
        })
        .catch((e) => {
          debugConsole.error("fetch with token error", e);
          responseResolve(e);
        });
    } else {
      debugConsole.error(
        "no token but is required for request, send authorization required message"
      );
      postAthorizationRequiredMessage(event, oAuthClientForRequest, session);
    }
  } else {
    fetch(event.request)
      .then((fetchResponse) => responseResolve(fetchResponse))
      .catch((e) => responseReject(e));
  }
});

async function postAthorizationRequiredMessage(
  event: FetchEvent,
  oAuthClient: AuthClient,
  session: Session
) {
  const swClient = await self.clients.get(event.clientId);
  console.log("discoveryUrl " + oAuthClient.config.discoveryUrl);
  const discoverOpenId = await getOpenIdConfiguration(self,
    oAuthClient.config.discoveryUrl
  );

  const verifier = generateRandomString();
  const codeChallenge = await pkceChallengeFromVerifier(verifier);
  const currentUrl = new URL(swClient.url);
  const state = {
    location: swClient.url.replace(currentUrl.origin, ""),
  };
  const url =
    discoverOpenId.authorization_endpoint +
    "?" +
    encodedStringFromObject(
      {
        client_id: oAuthClient.config.clientId,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        response_mode: "fragment",
        response_type: "code",
        redirect_uri: self.location.origin + oAuthClient.config.callbackPath,
        scope: oAuthClient.config.scope,
        state: JSON.stringify(state),
      },
      encodeURIComponent,
      "&"
    );
  authorizationCallbacksInProgress.push({
    sessionId: session.sessionId,
    verifier,
    tokenEndpoint: discoverOpenId.token_endpoint,
    oAuthClient,
    state,
  });

  swClient.postMessage({
    type: "authorize",
    client: oAuthClient.config.id,
    url,
  });
}

async function getWindowClient(id: string): Promise<WindowClient> {
  const clients = await self.clients.matchAll();
  return clients.find((client) => client.id === id) as WindowClient;
}

async function handleAuthorizationCallback(
  windowClient: WindowClient,
  callBack: AuthorizationCallbackParam
) {
  const hash = windowClient.url.split("#", 2)[1];
  const authResponse = getAuthorizationCallbackResponseData(hash);
  const body = encodedStringFromObject({
    client_id: callBack.oAuthClient.config.clientId,
    code: authResponse.code,
    code_verifier: callBack.verifier,
    grant_type: "authorization_code",
    redirect_uri: self.location.origin + callBack.oAuthClient.config.callbackPath,
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
    tokens.set(
      `${callBack.sessionId}_${callBack.oAuthClient.config.clientId}`,
      tokenResponse
    );
    windowClient.postMessage({
      type: "authorization-complete",
      tokens: tokenResponse,
      client: callBack.oAuthClient.config.id,
      location: callBack.state.location,
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
  ].forEach((token, index) => {
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

