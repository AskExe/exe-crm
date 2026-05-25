/**
 * Guards the AGPL §5 visible attribution text from accidental copy edits.
 *
 * Asserts only on REQUIRED text (per the legal/IP boundary). Anything that
 * could legitimately change (styling, layout, surrounding copy) is deliberately
 * NOT asserted on — only the strings that satisfy the license obligation.
 */

import { render, screen } from '@testing-library/react';

import { AboutExeCRMAttribution } from '../AboutExeCRMAttribution';

describe('AboutExeCRMAttribution', () => {
  beforeEach(() => {
    render(<AboutExeCRMAttribution />);
  });

  it('renders the modification notice naming Twenty as the original work', () => {
    expect(
      screen.getByText(
        'This software is a modified version of Twenty, originally created by Twenty.inc.',
      ),
    ).toBeInTheDocument();
  });

  it('renders the AGPLv3 license declaration', () => {
    expect(screen.getByText('Licensed under AGPLv3.')).toBeInTheDocument();
  });

  it('renders the source-code URL inline', () => {
    expect(
      screen.getByText(
        'Source code available at: https://github.com/AskExe/exe-crm',
      ),
    ).toBeInTheDocument();
  });

  it('renders a full-attribution link to the NOTICE file on GitHub', () => {
    const link = screen.getByRole('link', { name: 'View full attribution' });
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/AskExe/exe-crm/blob/main/NOTICE',
    );
  });
});
