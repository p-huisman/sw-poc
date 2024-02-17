import {
  encodedStringFromObject,
  generateRandomString,
  pkceChallengeFromVerifier,
} from "../helpers/crypto";
import { fetchWithToken } from "./fetch";
import { createOAuthDatabase, SessionRecord } from "./session-database";

declare var self: ServiceWorkerGlobalScope;

const oauthDatabase = createOAuthDatabase(self);

export type {};

interface CallbackParam {
  session: SessionRecord;
  verifier: string;
  tokenEndpoint: string;
  state: any;
}

let callBacksInProgress: CallbackParam[] = [];

const tokens = new Map<string, any>();

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
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

  if (callBacksInProgress.length > 0 && windowClient?.url) {
    handleAuthorizationCallback(windowClient, callBacksInProgress[0]);
    callBacksInProgress = [];
  }

  const session = await oauthDatabase.getSessionForRequest(
    event.request.url,
    event.clientId
  );

  if (session) {
    const tokenData = tokens.get(`${session.session}_${session.data.id}`);
    if (tokenData) {
      fetchWithToken(event.request, tokenData.access_token)
        .then((fetchResponse) => responseResolve(fetchResponse))
        .catch((e) => {
          // todo: renew token and retry request
          responseReject(e);
        });
    } else {
      // no token, but token is required
      postAtthorizationRequiredMessage(event, session);
    }
  } else {
    fetch(event.request)
      .then((fetchResponse) => responseResolve(fetchResponse))
      .catch((e) => responseReject(e));
  }
});

self.addEventListener("message", async (event: ExtendableMessageEvent) => {
  const eventClient = event.source as Client;

  switch (event.data.type) {
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
  }
});

async function postAtthorizationRequiredMessage(
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
  callBacksInProgress.push({
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
  callBack: CallbackParam
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
