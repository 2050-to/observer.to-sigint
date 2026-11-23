import { connection } from "next/server";
import { observerAppHtml } from "../../../lib/observer-app";

export async function GET() {
  await connection();
  return observerAppHtml();
}
