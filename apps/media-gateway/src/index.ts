import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { decideAuth, type MediaMtxAuthRequest } from "./auth-webhook.js";

const PORT = Number(process.env.MEDIA_GATEWAY_PORT ?? "8190");

// 인증 payload는 { user, password, action, path, ... } 정도의 짧은 JSON뿐이다 — 상한이 없으면
// 아무나 이 웹훅에 거대한 body를 보내 메모리를 소모시킬 수 있었다(코드 리뷰 P2 #20).
const MAX_AUTH_BODY_BYTES = 8 * 1024;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    let bytes = 0;
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_AUTH_BODY_BYTES) {
        req.destroy();
        reject(new Error("auth request body too large"));
        return;
      }
      data += chunk.toString();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function getPublishCredentials(): { username: string; password: string } | undefined {
  const username = process.env.MEDIAMTX_PUBLISH_USERNAME;
  const password = process.env.MEDIAMTX_PUBLISH_PASSWORD;
  return username && password ? { username, password } : undefined;
}

async function handleAuth(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let payload: MediaMtxAuthRequest;
  try {
    payload = JSON.parse(await readBody(req)) as MediaMtxAuthRequest;
  } catch {
    res.writeHead(400).end();
    return;
  }
  res
    .writeHead(decideAuth(payload, process.env.AUTH_JWT_SECRET, undefined, getPublishCredentials()))
    .end();
}

export function main(): void {
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/auth") {
      void handleAuth(req, res);
      return;
    }
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ok" }));
      return;
    }
    res.writeHead(404).end();
  });

  server.listen(PORT, () => {
    console.log(
      `[media-gateway] 인증 웹훅 시작 http://0.0.0.0:${PORT}/auth (MediaMTX authHTTPAddress 대상, architecture.md §5-cam)`,
    );
  });

  const shutdown = (): void => {
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
