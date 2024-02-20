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
      authClientConfig["type"] = authClient.tagName.toLowerCase();

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

      const hasLogoffAll = sessionStorage.getItem("p-oauth-logoff-all");
      if (hasLogoffAll) {
        const allClients = JSON.parse(hasLogoffAll);
        if (allClients.length <= 1) {
          const location = sessionStorage.getItem("p-oauth-logoff-all-url");
          sessionStorage.removeItem("p-oauth-logoff-all");
          sessionStorage.removeItem("p-oauth-logoff-all-url");
          document.location.replace(location);
        }
      }
      
      const hasData = document.location.href
        .split("#", 2)[1]
        .split("&")
        .reduce((result: any, item: any) => {
          const parts = item.split("=");
          result[parts[0]] = decodeURIComponent(parts[1]);
          return result;
        }, {});
      if (hasData.post_end_session_redirect_uri) {
        console.log(
          "hasData.post_end_session_redirect_uri",
          hasData.post_end_session_redirect_uri
        );
        document.location.replace(hasData.post_end_session_redirect_uri);
      }
    }
  }

  logoff = async (url: string, client?: HTMLElement): Promise<void> => {
    console.log("logoff", url, client)
    
    if (!client) {
      let allClients =
        JSON.parse(sessionStorage.getItem("p-oauth-logoff-all")) || null;
        console.log("sessions storage", allClients);
      if (!allClients) {
        
        sessionStorage.setItem("p-oauth-logoff-all-url", url);
        allClients = (
          Array.from(this.childNodes).filter(
            (node) => node instanceof HTMLElement && node.id
          ) as HTMLElement[]
        ).map((node) => node.id);
        console.log("allClients from dom", allClients);
      }

      const firstClient = allClients.shift();
      const firstElement = this.querySelector<HTMLElement>(`#${firstClient}`);
      
      sessionStorage.setItem(
        "p-oauth-logoff-all",
        JSON.stringify(allClients)
      );
      
      if (firstClient) {
        
        const endSessionUrl =
        firstElement.getAttribute("callback-path") + 
              "#post_end_session_redirect_uri=" +
              encodeURIComponent(document.location.href.split("#", 1)[0]  );

        
        console.log("logoff from storage", url, firstClient);
        await this.#postLogoffMessage(endSessionUrl, firstElement);
        return;
      }
    } 
    else {
      console.log("logoff", url, client);
      await this.#postLogoffMessage(url, client);
    }
  };

  #postLogoffMessage = async (url: string, authClient: HTMLElement): Promise<void> => {
    const client =  Object.fromEntries(
      Array.from(authClient.attributes).map((item) => [
        kebabCaseToCamelCase(item.name),
        item.value,
      ])
    );
    client["type"] = authClient.tagName.toLowerCase();
    console.log("postLogoffMessage", url, client);
    await this.#serviceWorkerRegistrationActive;
    this.serviceWorkerRegistration.active.postMessage({
      session: this.session,
      type: "logoff",
      url,
      client,
    });
  };
}

customElements.define("p-oauth", POauthElement);
