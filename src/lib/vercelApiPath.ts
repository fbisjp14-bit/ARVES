export const restoreVercelApiPath = (req: any): void => {
  const currentUrl = new URL(req.url || '/api', 'http://localhost');
  const rewrittenPath =
    req.query?.__osone_path ??
    currentUrl.searchParams.get('__osone_path');
  if (!rewrittenPath) return;

  const pathValue = Array.isArray(rewrittenPath)
    ? rewrittenPath.join('/')
    : String(rewrittenPath);
  const safePath = pathValue.replace(/^\/+/, '').replace(/\.\.(?:\/|\\)/g, '');
  currentUrl.searchParams.delete('__osone_path');
  req.url = `/api/${safePath}${currentUrl.search}`;
};
