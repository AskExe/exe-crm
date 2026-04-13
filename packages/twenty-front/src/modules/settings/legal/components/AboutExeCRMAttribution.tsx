/**
 * AboutExeCRMAttribution — static AGPL §5 attribution block for Exe CRM.
 *
 * Required visible text and links MUST stay verbatim. Tests in
 * AboutExeCRMAttribution.test.tsx assert on the literal strings as a
 * guard against accidental copy edits. If you change attribution copy,
 * update legal review FIRST, then both the component and the tests.
 *
 * Kept as a pure presentation component (no Lingui, no router, no theme
 * hooks) so tests can render it without the full provider stack.
 */

const NOTICE_URL = 'https://github.com/AskExe/exe-crm/blob/main/NOTICE';
const SOURCE_URL = 'https://github.com/AskExe/exe-crm';

const ATTRIBUTION_PARAGRAPHS: readonly string[] = [
  'This software is a modified version of Twenty, originally created by Twenty.inc.',
  'Licensed under AGPLv3.',
  `Source code available at: ${SOURCE_URL}`,
];

const FULL_ATTRIBUTION_LABEL = 'View full attribution';

export const AboutExeCRMAttribution = () => (
  <div data-testid="about-exe-crm-attribution">
    {ATTRIBUTION_PARAGRAPHS.map((paragraph) => (
      <p key={paragraph}>{paragraph}</p>
    ))}
    <p>
      <a href={NOTICE_URL} target="_blank" rel="noreferrer noopener">
        {FULL_ATTRIBUTION_LABEL}
      </a>
    </p>
  </div>
);
