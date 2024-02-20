import { encodedStringFromObject } from "../../helpers/crypto";
import { getOpenIdConfiguration } from "../openid-configurations";
import { AuthServiceWorker } from "../service-worker";
import { AuthClient, Session } from "../session-manager";


interface LogoffConfig {
  serviceWorker: AuthServiceWorker;
  authClient: AuthClient;
  session: Session;
  event: ExtendableMessageEvent;
}

/**
 * Code flow logoff handler
 * 
 * @param config LogoffConfig
 * @returns Promise<void>
 * @description 
 * This function is used to logoff the user from the application. 
 * It revokes the tokens and removes the token from the session manager.
 * it also sends a message to the client to redirect to the end session endpoint.
 */
export default async (config: LogoffConfig): Promise<void> => {
  const tokenData = await config.serviceWorker.sessionManager.getToken(
    config.event.data.session,
    config.authClient.id
  );
  if (tokenData) {
    const discoverOpenId = await getOpenIdConfiguration(
      config.serviceWorker,
      config.authClient.discoveryUrl
    );
    await revokeTokens(
      discoverOpenId.revocation_endpoint,
      config.authClient.clientId,
      tokenData
    );
    const serviceWorkerClient = await config.serviceWorker.clients.get(
      config.session.window
    );
    const currentUrl = new URL(serviceWorkerClient.url);
    const params =
      "?" +
      encodedStringFromObject(
        {
          id_token_hint: tokenData.id_token,
          post_logout_redirect_uri:
            currentUrl.origin +
            config.authClient.callbackPath + "?c=" + config.authClient.id +
            "#post_end_session_redirect_uri=" +
            encodeURIComponent(config.event.data.url),
        },
        encodeURIComponent,
        "&"
      );
    await config.serviceWorker.sessionManager.removeToken(
      config.event.data.session,
      config.authClient.id
    );
    serviceWorkerClient.postMessage({
      type: "end-session",
      location: discoverOpenId.end_session_endpoint + params,
    });
  } else {
    const allClients = await config.serviceWorker.clients.matchAll({ type: "window" });
    const client = allClients.find((client) => client.focused === true);
    const location = config.authClient.callbackPath + "?c=" + config.authClient.id +
    "#post_end_session_redirect_uri=" + config.event.data.url;
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
function revokeTokens(tokenEndpoint: string, clientId: string, tokens: any): Promise<Response[]> {
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
  token: string
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
