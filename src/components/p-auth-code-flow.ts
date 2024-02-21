import {P_AUTH_CODE_FLOW} from "../constants";
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
            document.location.href = event.data.url;
          } else if (
            event.data.type === "authorization-complete" &&
            event.data.client === this.id
          ) {
            sessionStorage.setItem(
              this.id + "_tokens",
              JSON.stringify(event.data.tokens),
            );
            document.location.replace(event.data.location);
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

  logoff(url?: string) {
    sessionStorage.removeItem(this.id + "_tokens");
    if (!url) {
      return;
    }
    this.oAuth.logoff(url, this);
  }
}
customElements.define(P_AUTH_CODE_FLOW, AuthCodeFlowElement);
