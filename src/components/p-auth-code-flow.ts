import { PAuthBaseElement } from "./p-auth-base";

export class AuthCodeFlowElement extends PAuthBaseElement{
  /**
   *
   */
  constructor() {
    super();
    customElements.whenDefined('p-oauth').then(() => {
      this.oAuth.registerAuthClient(this);
    });
  }
  
}
customElements.define('p-auth-code-flow', AuthCodeFlowElement);