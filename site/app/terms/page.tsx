import { readFileSync } from "node:fs";
import path from "node:path";

export default function TermsPage() {
  const text = readFileSync(path.join(process.cwd(), "..", "legal", "terms.md"), "utf8");
  return (
    <main>
      <p className="note">
        <a href="/">Observer.to</a>
        {" · "}
        <a href="/privacy">Privacy Policy</a>
      </p>
      <article className="legal-copy">{text}</article>
    </main>
  );
}
