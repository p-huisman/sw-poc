import { fetchQueueAndRestoreOriginalFetch } from "./helpers/fetch-q";
import { kebabCaseToCamelCase } from "./helpers/string";
import "./p-auth-code-flow";

export class SwDataElement extends HTMLElement {
  serviceWorkerRegistrationReady(): Promise<void> {
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (this.#swRegistration) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });
  }

  waitForReadyForFecth(): Promise<void> {
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (this.readyForFetch) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });
  }

  private get authClients() {
    return Array.from(this.children).map((el) => {
      const attr = Object.fromEntries(
        Array.from(el.attributes).map((item) => [
          kebabCaseToCamelCase(item.name),
          item.value,
        ])
      );
      return {
        type: el.tagName.toLowerCase(),
        ...attr,
      };
    });
  }

  constructor(private readyForFetch = false) {
    super();
    this.#isCallbackPage =
      document.location.hash.indexOf("#") === 0 &&
      document.location.hash.indexOf("code=") > -1;
    if (!this.#isCallbackPage) {
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data.type === "AUTHORIZATION_REQUIRED") {
          sessionStorage.setItem("verifier", event.data.verifier);
          sessionStorage.setItem("clientId", event.data.clientId);
          const authorizationUrl = new URL(event.data.authorizationUrl);
          const state = JSON.stringify({
            location: document.location.href.replace(
              document.location.origin,
              ""
            ),
          });
          authorizationUrl.searchParams.set("state", state);
          document.location.href = authorizationUrl.toString();
        }
      });
    }

    if (!("serviceWorker" in navigator)) {
      console.error("Service workers are not supported by this browser");
      return;
    }
    const script = window.document.querySelector<HTMLScriptElement>(
      'script[src*="/p-ajax."]'
    );
    if (!script) {
      console.error("p-ajax script source not found");
      return;
    }

    const swSrc =
      new URL(script.src).pathname.split("/").slice(0, -1).join("/") +
      "/p-ajax-sw.js";

    navigator.serviceWorker
      .register(swSrc, { scope: "/" })
      .then((registration) => {
        this.#swRegistration = registration;
        console.log(
          "Service Worker registered with scope:",
          registration.scope
        );
      })
      .catch((error) => {
        console.error("Service Worker registration failed ", error);
      });
  }

  static get observedAttributes() {
    return ["token", "token-endpoint", "base-url"];
  }

  #isCallbackPage = false;

  #swRegistration: ServiceWorkerRegistration;

  #token: string;

  #tokenEndpoint: string;

  #baseUrl: string;

  get token() {
    return this.#token;
  }

  set token(value: string) {
    this.#token = value;
    this.#updateConfig();
  }

  get tokenEndpoint() {
    return this.#tokenEndpoint;
  }

  set tokenEndpoint(value: string) {
    this.#tokenEndpoint = value;
    this.#updateConfig();
  }

  get dataBaseUrl() {
    return this.#baseUrl;
  }

  set dataBaseUrl(value: string) {
    this.#baseUrl = value;
    this.#updateConfig();
  }

  get session(): string {
    let session = sessionStorage.getItem("p-ajax-session");
    if (!session) {
      session = `${Math.random()
        .toString(36)
        .substring(2)}-${new Date().getTime()}`;
      sessionStorage.setItem("p-ajax-session", session);
    }
    return session;
  }

  async #processCallback(verifier: string, clientId: string) {
    await this.serviceWorkerRegistrationReady();
    const messageChannel = new MessageChannel();

    messageChannel.port1.onmessage = (event) => {
      if (event.data.type === "AUTHORIZATION_RESPONSE") {
        console.log("AUTHORIZATION_RESPONSE", event.data);
      }
    };
    this.#swRegistration.active?.postMessage({
      type: "AUTHORIZATION_RESPONSE",
      session: this.session,
      authClients: this.authClients,
      verifier,
      clientId,
    });
  }

  async #updateConfig() {
    if (
      !this.#token ||
      !this.#tokenEndpoint ||
      !this.#baseUrl ||
      this.#isCallbackPage
    ) {
      return;
    }
    await this.serviceWorkerRegistrationReady();
    const messageChannel = new MessageChannel();

    messageChannel.port1.onmessage = (event) => {
      if (event.data.type === "CONFIG") {
        this.readyForFetch = true;
        fetchQueueAndRestoreOriginalFetch();
      }
    };

    this.#swRegistration.active?.postMessage(
      {
        type: "CONFIG",
        session: this.session,
        authClients: this.authClients,
      },
      [messageChannel.port2]
    );
  }

  connectedCallback() {
    if (this.#isCallbackPage) {
      const verifier = sessionStorage.getItem("verifier");
      const clientId = sessionStorage.getItem("clientId");
      // sessionStorage.removeItem("verifier");
      // sessionStorage.removeItem("clientId");
      this.#processCallback(verifier, clientId);
    }
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if (name === "token") {
      this.#token = newValue;
    } else if (name === "token-endpoint") {
      this.#tokenEndpoint = newValue;
    } else if (name === "base-url") {
      this.#baseUrl = newValue;
    }
    this.#updateConfig();
  }

  get ready(): Promise<void> {
    return this.waitForReadyForFecth();
  }
}

customElements.define("p-ajax", SwDataElement);
