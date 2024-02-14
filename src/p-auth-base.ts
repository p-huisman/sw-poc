export class PAuthBaseElement extends HTMLElement {
  constructor() {
    super();
  }

  get closestPAjax() {
    return this.closest("p-ajax");
  }
  
}
