const defaultTimeout = 10000;

export class AuthFlowIFrameWrapper {
  private resolve: (value?: unknown | PromiseLike<unknown>) => void;
  private reject: (value?: unknown | PromiseLike<unknown>) => void;
  private promise: Promise<unknown>;
  private frame: HTMLIFrameElement;
  private timeout: number;
  private timer: any;

  constructor(timeout?: number) {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });

    window.addEventListener("message", this.messageHandler, false);

    this.timeout = timeout ? timeout : defaultTimeout; // in milliseconds

    this.frame = window.document.createElement("iframe");
    this.frame.style.visibility = "hidden";
    this.frame.style.position = "absolute";
    this.frame.style.display = "none";
    this.frame.style.width = "0";
    this.frame.style.height = "0";
    document.body.appendChild(this.frame);
  }

  public navigate(url: string) {
    if (!url) {
      this.error();
    } else {
      this.timer = window.setTimeout(this.timeoutHandler, this.timeout);
      this.frame.src = url;
    }
    return this.promise;
  }

  public close() {
    this.cleanup();
  }

  private get origin() {
    return location.protocol + "//" + location.host;
  }

  private success() {
    this.cleanup();
    this.resolve(true);
  }

  private error() {
    this.cleanup();
    this.resolve(false);
  }

  private cleanup() {
    if (this.frame) {
      window.removeEventListener("message", this.messageHandler, false);
      window.clearTimeout(this.timer);
      document.body.removeChild(this.frame);

      this.timer = null;
      this.frame = null;
    }
  }

  private timeoutHandler = () => {
    this.error();
  };

  private messageHandler = (e: MessageEvent) => {
    // timer must (still) exist, so navigate was called but no timeout occurred yet
    // and security check that message comes from same domain and is same type
    if (
      this.timer !== null &&
      e.origin === this.origin &&
      e.data &&
      e.data.type &&
      e.data.type === "silent-signin"
    ) {
      if (e.data.success) {
        this.success();
      } else {
        this.error();
      }
    }
  };
}
