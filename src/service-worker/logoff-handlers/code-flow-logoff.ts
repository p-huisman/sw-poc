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
            config.authClient.callbackPath +
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
  }
};

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
