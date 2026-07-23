import { restoreVercelApiPath } from "../src/lib/vercelApiPath.ts";
import app from "./serverless.ts";

export default function handler(req: any, res: any) {
  restoreVercelApiPath(req);
  return app(req, res);
}
