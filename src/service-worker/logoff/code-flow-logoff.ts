import { AuthServiceWorker } from "../service-worker";
import { AuthClient, Session } from "../session-manager";

interface LogoffConfig {
  serviceWorker: AuthServiceWorker;
  authClient: AuthClient;
  session: Session;
  event: FetchEvent;
}

export default async (config: LogoffConfig): Promise<void> => {
  const tokenData = await self.sessionManager.getToken(
    config.event.data.session,
    config.authClient.id
  );
  if (currentSession && tokenData) {
    const discoverOpenId = await getOpenIdConfiguration(
      self,
      currentAuthClient.discoveryUrl
    );
    await revokeTokens(
      discoverOpenId.revocation_endpoint,
      currentAuthClient.clientId,
      tokenData
    );
    const serviceWorkerClient = await self.clients.get(window);
    const currentUrl = new URL(serviceWorkerClient.url);

    const params =
      "?" +
      encodedStringFromObject(
        {
          id_token_hint: tokenData.id_token,
          post_logout_redirect_uri:
            currentUrl.origin +
            currentAuthClient.callbackPath +
            "#post_end_session_redirect_uri=" +
            encodeURIComponent(event.data.url),
        },
        encodeURIComponent,
        "&"
      );
    await self.sessionManager.removeToken(
      event.data.session,
      currentAuthClient.id
    );

    serviceWorkerClient.postMessage({
      type: "end-session",
      location: discoverOpenId.end_session_endpoint + params,
    });
}