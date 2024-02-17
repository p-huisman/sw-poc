import { PAuthBaseElement } from "./p-auth-base";

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
            sessionStorage.setItem(this.id, JSON.stringify(event.data));
            document.location.replace(event.data.location);
          }
        }
      );
    });
  }

  logoff(url: string) {
    console.log("logoff", this.id);
    this.oAuth.logoff(this.id, url);
  }
}
customElements.define("p-auth-code-flow", AuthCodeFlowElement);
