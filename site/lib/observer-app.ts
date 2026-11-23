import { readFile } from "node:fs/promises";
import path from "node:path";

export async function observerAppHtml(): Promise<Response> {
  const html = await readFile(path.join(process.cwd(), "..", "dist", "index.html"));
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      "Strict-Transport-Security": "max-age=15552000; includeSubDomains",
      "Content-Security-Policy": "upgrade-insecure-requests",
    },
  });
}
