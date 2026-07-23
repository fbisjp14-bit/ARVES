export const restoreVercelApiPath = (req: any): void => {
  const rewrittenPath = req.query?.__osone_path;
  if (!rewrittenPath) return;

  const pathValue = Array.isArray(rewrittenPath)
    ? rewrittenPath.join('/')
    : String(rewrittenPath);
  const safePath = pathValue.replace(/^\/+/, '').replace(/\.\.(?:\/|\\)/g, '');
  const currentUrl = new URL(req.url || '/api', 'http://localhost');
  currentUrl.searchParams.delete('__osone_path');
  req.url = `/api/${safePath}${currentUrl.search}`;
};

