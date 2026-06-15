import { type ComponentInstanceStateContext } from '@/ui/utilities/state/component-state/types/ComponentInstanceStateContext';

declare global {
  interface Window {
    _env_?: Record<string, string>;
    __APOLLO_CLIENT__?: any;
    grecaptcha?: any;
    turnstile?: any;
    componentComponentStateContextMap: Map<
      string,
      ComponentInstanceStateContext<any>
    >;
    FrontChat?: (method: string, ...args: any[]) => void;
  }

  // Web Component: <exe-service-switcher>
  // Allows JSX usage without TypeScript complaining about unknown elements.
  namespace JSX {
    interface IntrinsicElements {
      'exe-service-switcher': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          current?: string;
          user?: string;
          'base-url'?: string;
        },
        HTMLElement
      >;
    }
  }
}
