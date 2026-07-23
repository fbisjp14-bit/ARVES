export const isStaticProductionHost = (
  hostname: string,
  isProductionBuild: boolean
): boolean => {
  const normalizedHost = hostname.toLowerCase();
  const isLocal =
    normalizedHost === 'localhost' ||
    normalizedHost === '127.0.0.1' ||
    normalizedHost.endsWith('.run.app') ||
    normalizedHost.includes('webcontainer-api.io');

  if (isLocal) return false;

  return (
    isProductionBuild ||
    normalizedHost.endsWith('.vercel.app') ||
    normalizedHost.endsWith('.netlify.app') ||
    normalizedHost.endsWith('.github.io') ||
    normalizedHost.endsWith('.pages.dev')
  );
};

export const shouldUseApiFallback = (
  response: Response,
  requestUrl: string
): boolean => {
  if (!requestUrl.includes('/api/')) return false;

  const contentType = response.headers.get('content-type')?.toLowerCase() || '';
  const vercelError = response.headers.get('x-vercel-error');
  const expectedJson = contentType.includes('application/json');

  return (
    response.status === 404 ||
    response.status >= 500 ||
    Boolean(vercelError) ||
    (!response.ok && !expectedJson)
  );
};
