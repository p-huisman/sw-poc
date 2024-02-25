import {AuthServiceWorker, AuthClient, Session} from "../../interfaces";
import {getOpenIdConfiguration} from "../openid-configurations";
import {postAuthorizationRequiredMessage} from "./fetch-interceptor";

interface UserinfoOptions {
  serviceWorker: AuthServiceWorker;
  authClient: AuthClient;
  session: Session;
  event: ExtendableMessageEvent;
}

export default async (options: UserinfoOptions): Promise<void> => {
  let tokenData = await options.serviceWorker.sessionManager.getToken(
    options.event.data.session,
    options.authClient.id,
  );
  if (!tokenData) {
    return Promise.reject("No token for client session");
  }
  console.log(options.event.source);
  let response: Response;
  if (tokenData) {
    const discoverOpenId = await getOpenIdConfiguration(
      options.serviceWorker,
      options.authClient.discoveryUrl,
    );
    console.log(discoverOpenId.userinfo_endpoint);
    response = await fetch(discoverOpenId.userinfo_endpoint, {
      headers: {Authorization: `Bearer ${tokenData.access_token}`},
    });
    if (response.status === 401) {
      const silentRenew = await postAuthorizationRequiredMessage(
        options.serviceWorker,
        options.event,
        options.authClient,
        options.session,
        true,
      ).catch((e) => e);
      if (silentRenew instanceof Error) {
        return Promise.reject("Userinfo request failed");
      }
      tokenData = await options.serviceWorker.sessionManager.getToken(
        options.event.data.session,
        options.authClient.id,
      );
      if (!tokenData) {
        return Promise.reject("No token for client session");
      }
      response = await fetch(discoverOpenId.userinfo_endpoint, {
        headers: {Authorization: `Bearer ${tokenData.access_token}`},
      });
    } else if (response.status !== 200) {
      return Promise.reject("Userinfo request failed");
    }
    return response.json();
  }
};
