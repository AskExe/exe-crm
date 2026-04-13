import { AboutExeCRMAttribution } from '@/settings/legal/components/AboutExeCRMAttribution';
import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { SubMenuTopBarContainer } from '@/ui/layout/page/components/SubMenuTopBarContainer';
import { Trans, useLingui } from '@lingui/react/macro';
import { H2Title } from 'twenty-ui/display';
import { Section } from 'twenty-ui/layout';

export const SettingsAboutExeCRM = () => {
  const { t } = useLingui();

  return (
    <SubMenuTopBarContainer
      title={t`About`}
      links={[{ children: <Trans>About</Trans> }]}
    >
      <SettingsPageContainer>
        <Section>
          <H2Title
            title={t`About Exe CRM`}
            description={t`Attribution and source code for the AGPLv3 fork.`}
          />
          <AboutExeCRMAttribution />
        </Section>
      </SettingsPageContainer>
    </SubMenuTopBarContainer>
  );
};
