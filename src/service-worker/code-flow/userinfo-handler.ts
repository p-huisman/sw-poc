import {AuthServiceWorker, AuthClient, Session} from "../../interfaces";
import {fetchWithAuthorizationHeader} from "../fetch";
import {getOpenIdConfiguration} from "../openid-configurations";

interface UserinfoConfig {
  serviceWorker: AuthServiceWorker;
  authClient: AuthClient;
  session: Session;
  event: ExtendableMessageEvent;
}

export default async (config: UserinfoConfig): Promise<void> => {
  const tokenData = await config.serviceWorker.sessionManager.getToken(
    config.event.data.session,
    config.authClient.id,
  );
  if (!tokenData) {
    return Promise.reject("No token for client session");
  }
  if (tokenData) {
    const discoverOpenId = await getOpenIdConfiguration(
      config.serviceWorker,
      config.authClient.discoveryUrl,
    );
    console.log(discoverOpenId.userinfo_endpoint);
    const response = await fetch(discoverOpenId.userinfo_endpoint, {
      headers: {Authorization: `Bearer ${tokenData.access_token}`},
    });
    if (response.status !== 200) {
      return Promise.reject("Userinfo request failed");
    }
    return response.json();
  }
};
