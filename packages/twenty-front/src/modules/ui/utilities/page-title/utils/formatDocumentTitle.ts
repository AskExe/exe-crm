export const APP_BRAND_NAME = 'Exe CRM';

const BRAND_SUFFIX = `| ${APP_BRAND_NAME}`;

export const formatDocumentTitle = (title: string) => {
  const normalizedTitle = title.trim();

  if (normalizedTitle.length === 0) {
    return APP_BRAND_NAME;
  }

  if (
    normalizedTitle === APP_BRAND_NAME ||
    normalizedTitle.endsWith(BRAND_SUFFIX)
  ) {
    return normalizedTitle;
  }

  return `${normalizedTitle} ${BRAND_SUFFIX}`;
};
