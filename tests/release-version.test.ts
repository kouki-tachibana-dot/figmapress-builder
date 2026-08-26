import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootPackagePath = new URL("../package.json", import.meta.url);
const webPackagePath = new URL("../apps/web/package.json", import.meta.url);
const converterPath = new URL(
  "../apps/web/src/components/converter-app.tsx",
  import.meta.url,
);

test("the production badge matches the package release", async () => {
  const [rootPackage, webPackage, converter] = await Promise.all([
    readFile(rootPackagePath, "utf8").then(JSON.parse),
    readFile(webPackagePath, "utf8").then(JSON.parse),
    readFile(converterPath, "utf8"),
  ]);

  assert.equal(webPackage.version, rootPackage.version);
  assert.match(
    converter,
    new RegExp(`const APP_RELEASE = "${rootPackage.version.replaceAll(".", "\\.")}";`),
  );
});
