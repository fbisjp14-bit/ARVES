type NodeLikeResponse = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

export default function healthHandler(
  _req: unknown,
  res: NodeLikeResponse
): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify({
    ok: true,
    service: 'osone-api',
    runtime: 'isolated-vercel-function'
  }));
}
