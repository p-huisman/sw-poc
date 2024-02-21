import {POauthElement} from "./p-oauth";

export class PAuthBaseElement extends HTMLElement {
  constructor() {
    super();
  }

  get oAuth(): POauthElement {
    return this.closest("p-oauth");
  }
}
