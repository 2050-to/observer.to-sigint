import { lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(siteRoot, "../release/Observer.to.dmg");
const destDir = path.join(siteRoot, "public", "release");
const dest = path.join(destDir, "Observer.to.dmg");
const relativeTarget = path.relative(destDir, source);

mkdirSync(destDir, { recursive: true });

function currentLink() {
  try {
    return lstatSync(dest);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function sourceReady() {
  try {
    return lstatSync(source).isFile();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

const existing = currentLink();

if (!sourceReady()) {
  if (existing) unlinkSync(dest);
  console.log(
    "release/Observer.to.dmg is not built yet. /release/Observer.to.dmg will 404 until npm run mac:dmg.",
  );
  process.exit(0);
}

if (existing?.isSymbolicLink() && readlinkSync(dest) === relativeTarget) {
  process.exit(0);
}

if (existing) unlinkSync(dest);
symlinkSync(relativeTarget, dest);
