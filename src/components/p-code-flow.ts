import { PAuthClient } from "../interfaces";
import { PAuthElement } from "./p-auth";


export class PCodeFlowElement extends HTMLElement implements PAuthClient {

  #authElement: PAuthElement | null = null;


  get clientId() {
    return this.getAttribute("client-id") || '';
  }

  get discoveryUrl() {
    return this.getAttribute("discovery-url") || '';
  }

  get scope() {
    return this.getAttribute("scope") || '';
  }

  get callbackPath() {
    return this.getAttribute("callback-path") || '';
  }

  get urlPattern() {
    return this.getAttribute("url-pattern") || '';
  }

  set initialised(value: boolean) {
    if (value) {
      this.dataset.initialised = "true";
    } else {
      delete this.dataset.initialised;
    }
  }

  get initialised() {
    return this.dataset.initialised === "true";
  }

  logout(url?: string) {
    if (!this.#authElement) {
      console.error('PCodeFlowElement must be a child of a p-auth element');
      return;
    }
    this.#authElement.logout(this, url);
  }

  getUserInfo() {
    if (!this.#authElement) {
      console.error('PCodeFlowElement must be a child of a p-auth element');
      return Promise.reject('PCodeFlowElement must be a child of a p-auth element');
    }
    return this.#authElement.getUserInfo(this);
  }

  connectedCallback() {
    this.#authElement = this.closest('p-auth') as PAuthElement;
    if (!this.#authElement) {
      console.error('PCodeFlowElement must be a child of a p-auth element');
      return;
    }
    this.#authElement.registerAuthClient(this);
  }
}

customElements.define('p-code-flow', PCodeFlowElement);