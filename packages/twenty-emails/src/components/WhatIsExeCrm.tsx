import { type I18n } from '@lingui/core';
import { MainText } from 'src/components/MainText';
import { SubTitle } from 'src/components/SubTitle';

type WhatIsExeCrmProps = {
  i18n: I18n;
};

export const WhatIsExeCrm = ({ i18n }: WhatIsExeCrmProps) => {
  return (
    <>
      <SubTitle value={i18n._('What is Exe CRM?')} />
      <MainText>
        {i18n._(
          "It's a CRM, a software to help businesses manage their customer data and relationships efficiently.",
        )}
      </MainText>
    </>
  );
};
