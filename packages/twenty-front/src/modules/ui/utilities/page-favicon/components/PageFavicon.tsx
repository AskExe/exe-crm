import { Helmet } from 'react-helmet-async';

export const PageFavicon = () => (
  <Helmet>
    <link
      rel="icon"
      type="image/svg+xml"
      href="/images/icons/exe/exe-favicon.svg?v=exe-1"
    />
  </Helmet>
);
