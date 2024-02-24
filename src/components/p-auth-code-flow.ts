import {P_AUTH_CODE_FLOW} from "../constants";
import {kebabCaseToCamelCase} from "../helpers/string";
import {AuthFlowIFrameWrapper} from "../helpers/code-flow-iframe-wrapper";
import {PAuthBaseElement} from "./p-auth-base";

export class AuthCodeFlowElement extends PAuthBaseElement {
  constructor() {
    super();
    customElements.whenDefined("p-oauth").then(() => {
      this.oAuth.registerAuthClient(this);
      navigator.serviceWorker.addEventListener(
        "message",
        (event: MessageEventInit) => {
          if (
            event.data.type === "authorize" &&
            event.data.client === this.id
          ) {
            this.handleAuthorization(event);
          } else if (
            event.data.type === "authorization-complete" &&
            event.data.client === this.id
          ) {
            sessionStorage.setItem(
              this.id + "_tokens",
              JSON.stringify(event.data.tokens),
            );
            if (event.data.silent) {
              // we are in the callback page inside an iframe
              parent.postMessage({
                type: "silent-signin",
                success: event.data.error === undefined,
              });
            } else {
              document.location.replace(event.data.location);
            }
          } else {
            if (
              event.data.type === "token-refresh" &&
              event.data.client === this.id
            ) {
              sessionStorage.setItem(
                this.id + "_tokens",
                JSON.stringify(event.data.tokens),
              );
            }
          }
        },
      );
    });
  }

  async handleAuthorization(event: MessageEventInit<any>) {
    if (!event.data.silent) {
      document.location.href = event.data.url;
      return;
    }
    const iframeWrapper = new AuthFlowIFrameWrapper();
    const silentNewSuccess = await iframeWrapper.navigate(event.data.url);
    event.ports[0].postMessage({
      type: "silent-signin",
      success: silentNewSuccess,
      session: this.oAuth.session,
      authClientId: this.id,
    });
  }

  logoff(url?: string) {
    sessionStorage.removeItem(this.id + "_tokens");
    if (!url) {
      return;
    }
    this.oAuth.logoff(url, this);
  }

  async getUserinfo(): Promise<any> {
    return new Promise((resolve, reject) => {
      const messageChannel = new MessageChannel();
      messageChannel.port1.onmessage = (event) => {
        console.log("get user info");
        if (event.data.type === "userinfo") {
          messageChannel.port1.close();
          messageChannel.port2.close();
          if (event.data.error) {
            reject(
              new Error(
                event.data.error ? event.data.error : "User info error",
              ),
            );
          } else {
            resolve(event.data.userinfo);
          }
        }
      };
      const authClientConfig = Object.fromEntries(
        Array.from(this.attributes).map((item) => [
          kebabCaseToCamelCase(item.name),
          item.value,
        ]),
      );
      authClientConfig["type"] = this.tagName.toLowerCase();

      this.oAuth.serviceWorkerRegistration.active.postMessage(
        {
          type: "userinfo",
          session: this.oAuth.session,
          authClient: authClientConfig,
        },
        [messageChannel.port2],
      );
    });
  }
}
customElements.define(P_AUTH_CODE_FLOW, AuthCodeFlowElement);
