import {encodedStringFromObject} from "../../helpers/crypto";
import {AuthServiceWorker, AuthorizationCallbackParam} from "../../interfaces";

export default async (
  serviceWorker: AuthServiceWorker,
  windowClient: WindowClient,
  callBack: AuthorizationCallbackParam,
): Promise<void> => {
  // get code verifier from hash
  const hash = windowClient.url.split("#", 2)[1];
  const authResponse = getAuthorizationCallbackResponseObject(hash);
  const body = encodedStringFromObject({
    client_id: callBack.authClient.clientId,
    code: authResponse.code,
    code_verifier: callBack.data.verifier,
    grant_type: "authorization_code",
    redirect_uri:
      serviceWorker.location.origin + callBack.authClient.callbackPath,
  });

  // get token with verifier
  const tokenResponse = await fetch(callBack.data.tokenEndpoint, {
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
    // save token
    serviceWorker.sessionManager
      .setToken(callBack.sessionId, callBack.authClient.id, tokenResponse)
      .then(() => {
        windowClient.postMessage({
          type: "authorization-complete",
          tokens: tokenResponse,
          client: callBack.authClient.id,
          location: callBack.data.state.location,
        });
      });
  }
};

function getAuthorizationCallbackResponseObject(queryString: string): any {
  if (queryString.indexOf("error=") > -1) {
    return new Error(queryString); // todo get error from query string
  }
  return queryString.split("&").reduce((result: any, item: any) => {
    const parts = item.split("=");
    result[parts[0]] = decodeURIComponent(parts[1]);
    return result;
  }, {});
}
