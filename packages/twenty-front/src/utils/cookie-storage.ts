import Cookies from 'js-cookie';

class CookieStorage {
  private keys: Set<string> = new Set();

  getItem(key: string): string | undefined {
    // Primary: js-cookie
    const value = Cookies.get(key);

    if (value !== undefined && value.length > 0) {
      return value;
    }

    // Fallback: read directly from document.cookie.
    // js-cookie can silently return undefined when cookie encoding doesn't
    // match its expected format (e.g. mixed encoded/unencoded values).
    try {
      const match = document.cookie
        .split(';')
        .find((c) => c.trim().startsWith(key + '='));

      if (!match) return undefined;

      const rawValue = match.trim().substring(key.length + 1);

      if (!rawValue || rawValue.length === 0) return undefined;

      try {
        return decodeURIComponent(rawValue);
      } catch {
        return rawValue;
      }
    } catch {
      return undefined;
    }
  }

  setItem(
    key: string,
    value: string,
    attributes?: Cookies.CookieAttributes,
  ): void {
    this.keys.add(key);

    const secureAttributes = {
      secure: window.location.protocol === 'https:',
      sameSite: 'lax' as const,
      ...attributes,
    };

    Cookies.set(key, value, secureAttributes);
  }

  removeItem(key: string, attributes?: Cookies.CookieAttributes): void {
    this.keys.delete(key);
    Cookies.remove(key, attributes);
  }

  clear(): void {
    this.keys.forEach((key) => this.removeItem(key));
  }
}

export const cookieStorage = new CookieStorage();
