import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { connection } from "next/server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ name: string }> },
) {
  await connection();
  const { name } = await context.params;
  if (name !== "Observer.to.dmg") return new Response("not found", { status: 404 });

  const redirect = process.env.MAC_DMG_URL?.trim();
  if (redirect?.startsWith("https://")) return Response.redirect(redirect, 302);

  const candidates = [
    process.env.MAC_DMG_PATH,
    "/var/observer/Observer.to.dmg",
    path.join(process.cwd(), "..", "release", "Observer.to.dmg"),
    path.join(process.cwd(), "public", "release", "Observer.to.dmg"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) return new Response("not found", { status: 404 });

  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="Observer.to.dmg"',
      "Cache-Control": "public, max-age=300",
    },
  });
}
