interface FetchQueueItem {
  args: [URL | RequestInfo, RequestInit?];
  resolve: (value: Response) => void;
  reject: (reason: Error) => void;
}

const originalFetch = window.fetch;
const fetchQueue: FetchQueueItem[] = [];

const fetchQueueFn = async (
  url: URL | RequestInfo,
  requestInit?: RequestInit
): Promise<Response> => {
  const qItem: any = {
    args: [url, requestInit],
  };
  const promise = new Promise((resolve, reject) => {
    qItem.resolve = resolve;
    qItem.reject = reject;
  });
  fetchQueue.push(qItem);
  return promise as Promise<Response>;
};

window.fetch = fetchQueueFn;

function fetchQueueAndRestoreOriginalFetch() {
  window.fetch = originalFetch;
  const queue = fetchQueue.splice(0, fetchQueue.length);
  queue.forEach((item: any) => {
    if (item.args) {
      originalFetch(item.args[0], item.args[1])
        .then((response: any) => {
          item.resolve(response);
        })
        .catch((error) => {
          item.reject(error);
        });
    }
  });
}

export class SwDataElement extends HTMLElement {
  waitForSwRegistration(): Promise<void> {
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

  constructor(private readyForFetch = false) {
    super();

    if (!("serviceWorker" in navigator)) {
      console.error("Service workers are not supported by this browser");
      return;
    }
    const script = window.document.querySelector<HTMLScriptElement>(
      'script[src*="/sw-data."]'
    );
    if (!script) {
      console.error("sw-data.js not found");
      return;
    }

    const swSrc =
      new URL(script.src).pathname.split("/").slice(0, -1).join("/") +
      "/sw-data-service-worker.js";

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

  async #updateConfig() {
    if (!this.#token || !this.#tokenEndpoint || !this.#baseUrl) {
      return;
    }
    await this.waitForSwRegistration();
    const messageChannel = new MessageChannel();

    messageChannel.port1.onmessage = (event) => {
      if (event.data.type === "CONFIG_UPDATED") {
        this.readyForFetch = true;
        fetchQueueAndRestoreOriginalFetch();
      }
    };

    this.#swRegistration.active?.postMessage(
      {
        type: "UPDATE_CONFIG",
        token: this.#token,
        tokenEndpoint: this.#tokenEndpoint,
        baseUrl: this.#baseUrl,
      },
      [messageChannel.port2]
    );
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

customElements.define("sw-data", SwDataElement);
