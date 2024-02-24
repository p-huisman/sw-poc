import {AuthServiceWorker, AuthClient, Session} from "../../interfaces";
import {getOpenIdConfiguration} from "../openid-configurations";

interface UserinfoOptions {
  serviceWorker: AuthServiceWorker;
  authClient: AuthClient;
  session: Session;
  event: ExtendableMessageEvent;
}

export default async (options: UserinfoOptions): Promise<void> => {
  const tokenData = await options.serviceWorker.sessionManager.getToken(
    options.event.data.session,
    options.authClient.id,
  );
  if (!tokenData) {
    return Promise.reject("No token for client session");
  }
  if (tokenData) {
    const discoverOpenId = await getOpenIdConfiguration(
      options.serviceWorker,
      options.authClient.discoveryUrl,
    );
    const response = await fetch(discoverOpenId.userinfo_endpoint, {
      headers: {Authorization: `Bearer ${tokenData.access_token}`},
    });
    // todo: incase of 401, refresh token and retry
    if (response.status !== 200) {
      return Promise.reject("Userinfo request failed");
    }
    return response.json();
  }
};
