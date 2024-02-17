import {
  encodedStringFromObject,
  generateRandomString,
  pkceChallengeFromVerifier,
} from "../helpers/crypto";
import { setupDebugConsole } from "./debug-console";
import { fetchWithToken } from "./fetch";
import { createOAuthDatabase, SessionRecord } from "./session-database";

export type {};

interface AuthorizationCallbackParam {
  session: SessionRecord;
  verifier: string;
  tokenEndpoint: string;
  state: any;
}


declare var self: ServiceWorkerGlobalScope;
const oauthDatabase = createOAuthDatabase(self);
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
  const eventClient = event.source as Client;

  switch (event.data.type) {
    case "debug-console":
      debugConsole = setupDebugConsole(event.data.debug, "[SW]");
      break;
    
    case "register-auth-client":
      // remove old sessions
      await oauthDatabase.removeExpiredSessions();

      // add or update session
      const { authClient, session } = event.data;
      await oauthDatabase.addSession(
        session,
        eventClient.id,
        authClient.id,
        authClient
      );

      event.ports[0].postMessage({
        type: "register-auth-client",
        success: true,
      });
      break;
   
    case "logoff":
      const tokenData = tokens.get(
        `${event.data.session}_${event.data.clientId}`
      );
      const currentSession = await oauthDatabase.getSession(
        event.data.session,
        event.data.clientId
      );
      if (currentSession && tokenData) {
        const discoverOpenId = await oauthDatabase.getOpenIdConfiguration(
          currentSession.data.discoveryUrl
        );
        await revokeTokens(
          discoverOpenId.revocation_endpoint,
          currentSession.data.clientId,
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
              currentSession.data.callbackPath + "#post_end_session_redirect_uri=" + encodeURIComponent(event.data.url),
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
  
  const session = await oauthDatabase.getSessionForRequest(
    event.request.url,
    event.clientId
  );

  if (session) {
    let tokenData = tokens.get(`${session.session}_${session.data.id}`);
    const discoverOpenId = await oauthDatabase.getOpenIdConfiguration(
      session.data.discoveryUrl
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
              session.data.clientId,
              tokenData.refresh_token
            )
              .then((response) => {
                if (response.ok) {
                  debugConsole.info("token refreshed");
                  response.json().then((newTokenData) => {
                    tokens.set(
                      `${session.session}_${session.data.id}`,
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
                          postAthorizationRequiredMessage(event, session);
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
                  postAthorizationRequiredMessage(event, session);
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
      postAthorizationRequiredMessage(event, session);
    }
  } else {
    fetch(event.request)
      .then((fetchResponse) => responseResolve(fetchResponse))
      .catch((e) => responseReject(e));
  }
});

async function postAthorizationRequiredMessage(
  event: FetchEvent,
  session: SessionRecord
) {
  const swClient = await self.clients.get(event.clientId);
  const discoverOpenId = await oauthDatabase.getOpenIdConfiguration(
    session.data.discoveryUrl
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
        client_id: session.data.clientId,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        response_mode: "fragment",
        response_type: "code",
        redirect_uri: self.location.origin + session.data.callbackPath,
        scope: session.data.scope,
        state: JSON.stringify(state),
      },
      encodeURIComponent,
      "&"
    );
  authorizationCallbacksInProgress.push({
    verifier,
    tokenEndpoint: discoverOpenId.token_endpoint,
    session,
    state,
  });

  swClient.postMessage({
    type: "authorize",
    client: session.data.id,
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
    client_id: callBack.session.data.clientId,
    code: authResponse.code,
    code_verifier: callBack.verifier,
    grant_type: "authorization_code",
    redirect_uri: self.location.origin + callBack.session.data.callbackPath,
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
      `${callBack.session.session}_${callBack.session.data.id}`,
      tokenResponse
    );
    windowClient.postMessage({
      type: "authorization-complete",
      tokens: tokenResponse,
      client: callBack.session.data.id,
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

