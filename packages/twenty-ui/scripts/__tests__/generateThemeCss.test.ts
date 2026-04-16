import {
  prepareThemeForRootCssVariableInjection,
  SPACING_VALUES,
  camelToKebab,
} from '../generateThemeCss';

// Small unit tests for the generator helpers. We deliberately test the
// pure functions (prepareThemeForRootCssVariableInjection) with fixture
// inputs rather than running the full file-writing main() — that gives
// deterministic, fast tests without touching the filesystem.

describe('prepareThemeForRootCssVariableInjection', () => {
  it('flattens a fixed input theme object into expected CSS entries', () => {
    const themeNode = {
      background: {
        primary: '#0F0E1A',
        secondary: '#15142A',
      },
      font: {
        color: {
          primary: '#F0EDE8',
        },
      },
      name: 'dark',
    };

    const entries = prepareThemeForRootCssVariableInjection({
      themeNode,
      prefix: 't',
    });

    const byName = new Map(entries);
    expect(byName.get('--t-background-primary')).toBe('#0F0E1A');
    expect(byName.get('--t-background-secondary')).toBe('#15142A');
    expect(byName.get('--t-font-color-primary')).toBe('#F0EDE8');
    expect(byName.get('--t-name')).toBe('dark');
    expect(entries).toHaveLength(4);
  });

  it('expands the spacing function into --name-0 ... --name-32 plus --name-0_5 and --name-1_5', () => {
    const themeNode = {
      spacing: (...args: number[]) =>
        args.map((m) => `${m * 4}px`).join(' '),
    };

    const entries = prepareThemeForRootCssVariableInjection({
      themeNode,
      prefix: 't',
    });
    const byName = new Map(entries);

    // 33 whole-number entries (0..32) + 0_5 + 1_5 = 35
    expect(entries).toHaveLength(SPACING_VALUES.length);
    expect(byName.get('--t-spacing-0')).toBe('0px');
    expect(byName.get('--t-spacing-1')).toBe('4px');
    expect(byName.get('--t-spacing-16')).toBe('64px');
    expect(byName.get('--t-spacing-32')).toBe('128px');
    expect(byName.get('--t-spacing-0_5')).toBe('2px');
    expect(byName.get('--t-spacing-1_5')).toBe('6px');
  });

  it('passes rgba(r,g,b,a) values through unchanged', () => {
    const themeNode = {
      border: {
        color: {
          strong: 'rgba(240, 237, 232, 0.16)',
          danger: 'rgba(248, 113, 113, 0.40)',
        },
      },
    };

    const entries = prepareThemeForRootCssVariableInjection({
      themeNode,
      prefix: 't',
    });
    const byName = new Map(entries);

    expect(byName.get('--t-border-color-strong')).toBe(
      'rgba(240, 237, 232, 0.16)',
    );
    expect(byName.get('--t-border-color-danger')).toBe(
      'rgba(248, 113, 113, 0.40)',
    );
  });

  it('passes strings already in color(display-p3 ...) form through unchanged', () => {
    const themeNode = {
      tag: {
        text: {
          gray: 'color(display-p3 0.5 0.5 0.5)',
        },
      },
      code: {
        text: {
          sky: 'color(display-p3 0.2 0.6 1)',
        },
      },
    };

    const entries = prepareThemeForRootCssVariableInjection({
      themeNode,
      prefix: 't',
    });
    const byName = new Map(entries);

    expect(byName.get('--t-tag-text-gray')).toBe(
      'color(display-p3 0.5 0.5 0.5)',
    );
    expect(byName.get('--t-code-text-sky')).toBe(
      'color(display-p3 0.2 0.6 1)',
    );
  });
});

describe('camelToKebab', () => {
  it('kebab-cases camelCase keys (supporting helper for the main flatten)', () => {
    expect(camelToKebab('backgroundPrimary')).toBe('background-primary');
    expect(camelToKebab('semiBold')).toBe('semi-bold');
    expect(camelToKebab('plain')).toBe('plain');
  });
});
