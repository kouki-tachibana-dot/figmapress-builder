import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

test("distributed Connector ZIP contains exactly the current plugin sources and release", () => {
  const root = resolve("wordpress-plugin");
  const zip = resolve("apps/web/public/downloads/figmapress-connector.zip");
  const files = (folder: string): string[] => readdirSync(resolve(root, folder), { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? files(`${folder}/${entry.name}`) : [`${folder}/${entry.name}`]);
  const expectedFiles = files("figmapress-connector").sort();
  const archiveFiles = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n").filter(name => !name.endsWith("/")).sort();
  assert.deepEqual(archiveFiles, expectedFiles);
  for (const file of expectedFiles) {
    assert.deepEqual(execFileSync("unzip", ["-p", zip, file]), readFileSync(resolve(root, file)), `Stale ZIP entry: ${file}`);
  }
  const manifest = JSON.parse(readFileSync("apps/web/public/downloads/figmapress-connector.json", "utf8"));
  const connectorPackage = JSON.parse(readFileSync("packages/wp-connector/package.json", "utf8"));
  assert.equal(manifest.version, connectorPackage.version);
  const header = readFileSync(resolve(root, "figmapress-connector/figmapress-connector.php"), "utf8");
  assert.equal(header.match(/\* Version:\s+(\S+)/)?.[1], manifest.version);
  const readme = readFileSync(resolve(root, "figmapress-connector/readme.txt"), "utf8");
  assert.equal(readme.match(/^Stable tag:\s+(\S+)/m)?.[1], manifest.version);
});
