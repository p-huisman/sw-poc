import { PAuthElement } from './components/p-auth';

describe('p-auth', () => {
  it('should be defined', () => {
    expect(customElements.get('p-auth')).toBeDefined();
  });

  it('should be an instance of PAuthElement', () => {
    const element = new PAuthElement();
    expect(element).toBeInstanceOf(PAuthElement);
  });
});
