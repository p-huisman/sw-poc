import {POauthElement} from "./p-oauth";

export class PAuthBaseElement extends HTMLElement {
  constructor() {
    super();
  }

  get oAuth(): POauthElement {
    return this.closest("p-oauth");
  }

  async getUserinfo(): Promise<any> {
    return Promise.reject(new Error("Not implemented"));
  }
}
