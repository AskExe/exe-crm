import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

// Execute the exact browser asset shipped in the CRM image. The small DOM
// adapter captures rendered markup without depending on a running application.
function renderSwitcher(domain?: string, signedIn = true): string {
  let Component: new () => TestElement;
  const attributes = new Map<string, string>();
  if (signedIn) attributes.set('user', 'member@example.test');
  if (domain) attributes.set('base-url', domain);
  class TestElement {
    shadow = { innerHTML: '' };
    attachShadow() {
      return this.shadow;
    }
    getAttribute(name: string) {
      return attributes.get(name) ?? null;
    }
    connectedCallback() {}
  }
  runInNewContext(
    readFileSync(
      resolve(
        __dirname,
        '../../../../../../twenty-front/public/exe-service-switcher.js',
      ),
      'utf8',
    ),
    {
      HTMLElement: TestElement,
      customElements: {
        get: () => undefined,
        define: (_name: string, constructor: new () => TestElement) => {
          Component = constructor;
        },
      },
      document: {
        createElement: () => ({
          textContent: '',
          get innerHTML() {
            return this.textContent;
          },
        }),
      },
    },
  );
  const element = new Component!();
  element.connectedCallback();
  return element.shadow.innerHTML;
}

describe('vendored service switcher logout', () => {
  it.each([undefined, 'customer.example.test'])(
    'uses central logout with domain %s',
    (domain) => {
      const markup = renderSwitcher(domain);
      expect(markup).toContain(
        `href="https://auth.${domain ?? 'askexe.com'}/logout" class="exe-ss-logout"`,
      );
    },
  );
  it('does not show account logout for anonymous navigation', () => {
    expect(renderSwitcher(undefined, false)).not.toContain(
      'class="exe-ss-logout"',
    );
  });
});
