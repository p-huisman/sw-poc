import {startFetchQueuing, stopFetchQueuing} from "./fetch-queue";
import {installServiceWorker} from "./sw-installer";

import "./p-auth-code-flow";
import {kebabCaseToCamelCase} from "../helpers/string";
import {AUTH_LOGOFF_ALL, AUTH_LOGOFF_ALL_URL} from "../constants";
import {PAuthBaseElement} from "./p-auth-base";

startFetchQueuing();

export class POauthElement extends HTMLElement {
  constructor() {
    super();
    let swInstallResolver: () => void;
    let swInstallRejecter: (reason?: any) => void;
    const promise = new Promise<void>((resolve, reject) => {
      swInstallResolver = resolve;
      swInstallRejecter = reject;
    });
    this.swInstalled = promise;
    installServiceWorker()
      .then((sw) => {
        this.serviceWorkerRegistration = sw;
        swInstallResolver();
      })
      .catch((error) => {
        console.error('Failed to install service worker:', error);
        swInstallRejecter(error);
      });
  }

  #hasMessageHandler: boolean = false;
  #messageHandler = (event: MessageEvent) => {
    if (event.data.type === "end-session") {
      if (event.data.replace) {
        document.location.replace(event.data.location);
      } else {
        document.location.href = event.data.location;
      }
    }
  };

  serviceWorkerRegistration: ServiceWorkerRegistration;

  get #serviceWorkerRegistrationActive(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        clearInterval(interval);
        reject(new Error("Service worker did not become active in time."));
      }, 10000);
      const interval = setInterval(() => {
        if (this.serviceWorkerRegistration?.active) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });
  }

  #initialAuthClients: HTMLElement[] = undefined;

  swInstalled: Promise<void>;

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

  #postLogoffMessage = async (
    url: string,
    authClient: HTMLElement,
  ): Promise<void> => {
    const client = Object.fromEntries(
      Array.from(authClient.attributes).map((item) => [
        kebabCaseToCamelCase(item.name),
        item.value,
      ]),
    );
    client["type"] = authClient.tagName.toLowerCase();
    await this.#serviceWorkerRegistrationActive;
    this.serviceWorkerRegistration.active.postMessage({
      session: this.session,
      type: "logoff",
      url,
      client,
    });
  };

  registerAuthClient = async (authClient: HTMLElement): Promise<void> => {
    await this.#serviceWorkerRegistrationActive;

    this.serviceWorkerRegistration.active.postMessage({
      type: "debug-console",
      debug: this.hasAttribute("debug"),
    });

    return new Promise((resolve) => {
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
        ]),
      );
      authClientConfig["type"] = authClient.tagName.toLowerCase();

      this.serviceWorkerRegistration.active.postMessage(
        {
          type: "register-auth-client",
          session: this.session,
          authClient: authClientConfig,
        },
        [messageChannel.port2],
      );
    });
  };

  connectedCallback(): void {
    if(!this.#initialAuthClients) {
      this.#initialAuthClients = Array.from(this.childNodes).filter(
        (n) => n instanceof HTMLElement,
      ) as HTMLElement[];
    }
    if (!this.#hasMessageHandler) {
      this.swInstalled.then(() => {
        navigator.serviceWorker.addEventListener("message", this.#messageHandler);
        this.#hasMessageHandler = true;
      });
    };
    
    if (document.location.hash.indexOf("post_end_session_redirect_uri=") > 0) {
      const hasLogoffAll = sessionStorage.getItem(AUTH_LOGOFF_ALL);
      if (hasLogoffAll) {
        const allClients = JSON.parse(hasLogoffAll);
        const logoffLocation = sessionStorage.getItem(AUTH_LOGOFF_ALL_URL);
        if (allClients.length === 0) {
          sessionStorage.removeItem(AUTH_LOGOFF_ALL);
          sessionStorage.removeItem(AUTH_LOGOFF_ALL_URL);
          document.location.replace(logoffLocation);
        } else {
          this.logoff(logoffLocation);
        }
        return;
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
        document.location.replace(hasData.post_end_session_redirect_uri);
      }
    }
  }

  disconnectedCallback(): void {
    if (this.#hasMessageHandler){
      navigator.serviceWorker.removeEventListener("message", this.#messageHandler);
      this.#hasMessageHandler = false;
    }
  }

  logoff = async (url: string, client?: HTMLElement): Promise<void> => {
    if (!client) {
      let allClientIds =
        JSON.parse(sessionStorage.getItem(AUTH_LOGOFF_ALL)) || null;
      if (!allClientIds) {
        sessionStorage.setItem(AUTH_LOGOFF_ALL_URL, url);
        allClientIds = (
          Array.from(this.childNodes).filter(
            (node) => node instanceof HTMLElement && node.id,
          ) as HTMLElement[]
        ).map((node) => node.id);
      }

      const firstClientId = allClientIds.shift();
      const firstElement = this.querySelector<HTMLElement>(`#${firstClientId}`);
      if (firstElement && 'logoff' in firstElement && typeof (firstElement as any).logoff === 'function') {
        // logoff without 2nd param (url)
        await (firstElement as any).logoff();
      }
      sessionStorage.setItem(AUTH_LOGOFF_ALL, JSON.stringify(allClientIds));

      if (firstClientId) {
        const endSessionUrl =
          firstElement.getAttribute("callback-path") +
          "#post_end_session_redirect_uri=" +
          encodeURIComponent(document.location.href.split("#", 1)[0]);
        await this.#postLogoffMessage(endSessionUrl, firstElement);
        return;
      }
    } else {
      await this.#postLogoffMessage(url, client);
    }
  };

  isLoggedIn = async (id?: string): Promise<boolean> => {
    const auth: PAuthBaseElement = id
      ? this.querySelector("#" + id)
      : (this.firstElementChild as PAuthBaseElement);
    // todo: wait for custom element to be defined
    let userInfo = null;
    try {
      userInfo = await auth.getUserinfo();
    } catch (e) {
      userInfo = null;
    }
    return userInfo !== null;
  };
}

customElements.define("p-oauth", POauthElement);
