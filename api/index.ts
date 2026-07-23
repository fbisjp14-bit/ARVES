import appPromise from "../server";
import { restoreVercelApiPath } from "../src/lib/vercelApiPath";

export default async function handler(req: any, res: any) {
  restoreVercelApiPath(req);
  const app = await appPromise;
  return app(req, res);
}
