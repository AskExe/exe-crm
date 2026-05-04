import { Helmet } from 'react-helmet-async';
import { formatDocumentTitle } from '@/ui/utilities/page-title/utils/formatDocumentTitle';

type PageTitleProps = {
  title: string;
};

export const PageTitle = (props: PageTitleProps) => {
  return (
    <Helmet>
      <title>{formatDocumentTitle(props.title)}</title>
    </Helmet>
  );
};
