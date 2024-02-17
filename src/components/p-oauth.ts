import { startInterseptingFetch, stopInterseptingFetch } from "./fetch-interceptor";
import { installServiceWorker } from "./sw-installer";

import "./p-auth-code-flow";
import { kebabCaseToCamelCase } from "../helpers/string";

startInterseptingFetch();

export class POauthElement extends HTMLElement {
  constructor(public serviceWorkerRegistration: ServiceWorkerRegistration) {
    super();
    let swInstallResolver: () => void;
    const promise = new Promise<void>((resolve) => { swInstallResolver = resolve });
    this.swInstalled = promise;
    installServiceWorker().then((sw) => {
      this.serviceWorkerRegistration = sw;
      swInstallResolver();
    });
    this.#initialAuthClients = Array.from(this.childNodes).filter((n) => n instanceof HTMLElement) as HTMLElement[];
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
    stopInterseptingFetch();
  };

  registerAuthClient = async (authClient: HTMLElement): Promise<void> => {
    await this.#serviceWorkerRegistrationActive;
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
      
      this.serviceWorkerRegistration.active.postMessage({
        type: "register-auth-client",
        session: this.session,
        authClient: authClientConfig,
      }, [messageChannel.port2]);
    });
  };

}

customElements.define("p-oauth", POauthElement);
