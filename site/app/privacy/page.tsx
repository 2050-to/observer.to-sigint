import { readFileSync } from "node:fs";
import path from "node:path";

export default function PrivacyPage() {
  const text = readFileSync(path.join(process.cwd(), "..", "legal", "privacy.md"), "utf8");
  return (
    <main>
      <p className="note">
        <a href="/">Observer.to</a>
        {" · "}
        <a href="/terms">Terms of Service</a>
      </p>
      <article className="legal-copy">{text}</article>
    </main>
  );
}
