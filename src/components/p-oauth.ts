import { startFetchQueuing, stopFetchQueuing } from "./fetch-queue";
import { installServiceWorker } from "./sw-installer";

import "./p-auth-code-flow";
import { kebabCaseToCamelCase } from "../helpers/string";

startFetchQueuing();

export class POauthElement extends HTMLElement {
  constructor(public serviceWorkerRegistration: ServiceWorkerRegistration) {
    super();
    let swInstallResolver: () => void;
    const promise = new Promise<void>((resolve) => {
      swInstallResolver = resolve;
    });
    this.swInstalled = promise;
    installServiceWorker().then((sw) => {
      this.serviceWorkerRegistration = sw;
      swInstallResolver();
    });
    this.#initialAuthClients = Array.from(this.childNodes).filter(
      (n) => n instanceof HTMLElement
    ) as HTMLElement[];
    navigator.serviceWorker.addEventListener(
      "message",
      (event: MessageEventInit) => {
        if (event.data.type === "end-session") {
          if (event.data.replace) {
            document.location.replace(event.data.location);
          } else {
            document.location.href = event.data.location;
          }
        }
      }
    );
  }

  get #serviceWorkerRegistrationActive(): Promise<void> {
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (this.serviceWorkerRegistration?.active) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });
  }

  swInstalled: Promise<void>;

  #initialAuthClients: HTMLElement[] = [];

  get session(): string {
    let session = sessionStorage.getItem("p-oauth-session");
    if (!session) {
      session = `${Math.random()
        .toString(36)
        .substring(2)}-${new Date().getTime()}`;
      sessionStorage.setItem("p-oauth-session", session);
    }
    return session;
  }

  #allAuthClientsRegistered = async (): Promise<void> => {
    stopFetchQueuing();
  };

  registerAuthClient = async (authClient: HTMLElement): Promise<void> => {
    await this.#serviceWorkerRegistrationActive;

    this.serviceWorkerRegistration.active.postMessage({
      type: "debug-console",
      debug: this.hasAttribute("debug"),
    });

    return new Promise((resolve, reject) => {
      const messageChannel = new MessageChannel();
      messageChannel.port1.onmessage = (event) => {
        if (event.data.type === "register-auth-client") {
          messageChannel.port1.close();
          messageChannel.port2.close();
          const index = this.#initialAuthClients.indexOf(authClient);
          if (index > -1) {
            this.#initialAuthClients.splice(index, 1);
          }
          if (this.#initialAuthClients.length === 0) {
            this.#allAuthClientsRegistered();
          }
          resolve();
        }
      };
      const authClientConfig = Object.fromEntries(
        Array.from(authClient.attributes).map((item) => [
          kebabCaseToCamelCase(item.name),
          item.value,
        ])
      );

      this.serviceWorkerRegistration.active.postMessage(
        {
          type: "register-auth-client",
          session: this.session,
          authClient: authClientConfig,
        },
        [messageChannel.port2]
      );
    });
  };

  connectedCallback(): void {
    if (document.location.hash.indexOf("post_end_session_redirect_uri=") > 0) {
      const hasData = document.location.href
        .split("#", 2)[1]
        .split("&")
        .reduce((result: any, item: any) => {
          const parts = item.split("=");
          result[parts[0]] = decodeURIComponent(parts[1]);
          return result;
        }, {});
      if (hasData.post_end_session_redirect_uri) {
        document.location.replace(hasData.post_end_session_redirect_uri);
      }
    }
  }

  logoff = async (clientId: string, url: string): Promise<void> => {
    await this.#serviceWorkerRegistrationActive;
    this.serviceWorkerRegistration.active.postMessage({
      type: "logoff",
      session: this.session,
      clientId,
      url,
    });
  };
}

customElements.define("p-oauth", POauthElement);
