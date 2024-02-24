import {encodedStringFromObject} from "../../helpers/crypto";
import {getOpenIdConfiguration} from "../openid-configurations";
import {AuthServiceWorker, AuthClient, Session} from "../../interfaces";

interface LogoffOptions {
  serviceWorker: AuthServiceWorker;
  authClient: AuthClient;
  session: Session;
  event: ExtendableMessageEvent;
}

/**
 * Code flow logoff handler
 *
 * @param options LogoffOptions
 * @returns Promise<void>
 * @description
 * This function is used to logoff the user from the application.
 * It revokes the tokens and removes the token from the session manager.
 * it also sends a message to the client to redirect to the end session endpoint.
 */
export default async (options: LogoffOptions): Promise<void> => {
  const tokenData = await options.serviceWorker.sessionManager.getToken(
    options.event.data.session,
    options.authClient.id,
  );
  if (tokenData) {
    const discoverOpenId = await getOpenIdConfiguration(
      options.serviceWorker,
      options.authClient.discoveryUrl,
    );
    await revokeTokens(
      discoverOpenId.revocation_endpoint,
      options.authClient.clientId,
      tokenData,
    );
    const serviceWorkerClient = await options.serviceWorker.clients.get(
      options.session.window,
    );
    const currentUrl = new URL(serviceWorkerClient.url);
    const params =
      "?" +
      encodedStringFromObject(
        {
          id_token_hint: tokenData.id_token,
          post_logout_redirect_uri:
            currentUrl.origin +
            options.authClient.callbackPath +
            "?c=" +
            options.authClient.id +
            "#post_end_session_redirect_uri=" +
            encodeURIComponent(options.event.data.url),
        },
        encodeURIComponent,
        "&",
      );
    await options.serviceWorker.sessionManager.removeToken(
      options.event.data.session,
      options.authClient.id,
    );
    serviceWorkerClient.postMessage({
      type: "end-session",
      location: discoverOpenId.end_session_endpoint + params,
    });
  } else {
    const allClients = await options.serviceWorker.clients.matchAll({
      type: "window",
    });
    const client = allClients.find((client) => client.focused === true);
    const location =
      options.authClient.callbackPath +
      "?c=" +
      options.authClient.id +
      "#post_end_session_redirect_uri=" +
      options.event.data.url;
    client.postMessage({
      type: "end-session",
      location,
    });
  }
};

/**
 * Revoke access and refresh token
 *
 * @param tokenEndpoint
 * @param clientId
 * @param tokens
 * @returns Promise<Response[]>
 */
function revokeTokens(
  tokenEndpoint: string,
  clientId: string,
  tokens: any,
): Promise<Response[]> {
  const revokePromises: Promise<Response>[] = [];
  [
    ["access_token", tokens.access_token],
    ["refresh_token", tokens.refresh_token],
  ].forEach((token) => {
    if (token) {
      revokePromises.push(
        revokeToken(tokenEndpoint, clientId, token[0], token[1]),
      );
    }
  });
  return Promise.all(revokePromises);
}

/**
 * Revoke a token
 *
 * @param tokenEndpoint
 * @param clientId
 * @param tokenType
 * @param token
 * @returns Promise<Response>
 */
function revokeToken(
  tokenEndpoint: string,
  clientId: string,
  tokenType: string,
  token: string,
): Promise<Response> {
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
