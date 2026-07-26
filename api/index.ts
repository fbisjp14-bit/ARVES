import { restoreVercelApiPath } from '../src/lib/vercelApiPath.js';
import app from './serverless.js';

export default function handler(req: any, res: any) {
  restoreVercelApiPath(req);
  return app(req, res);
}
