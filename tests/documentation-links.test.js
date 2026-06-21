import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const latestPortableUrl =
  "https://github.com/wangzhezbz/codex-bridge/releases/latest/download/CodexBridge-Windows-x64-Portable.zip";

test("public docs use the stable latest Windows download link", () => {
  for (const file of ["README.md", path.join("docs", "windows-portable.md"), path.join("docs", "releases.md")]) {
    const text = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    assert.match(text, new RegExp(escapeRegExp(latestPortableUrl)), `${file} should link latest portable build`);
    assert.doesNotMatch(text, /CodexBridge-windows-portable/i, `${file} should not use the old package name`);
  }
});

test("portable docs explain stable user data storage", () => {
  const text = fs.readFileSync(
    path.join(process.cwd(), "docs", "windows-portable.md"),
    "utf8",
  );

  assert.match(text, /%APPDATA%\\CodexBridge/);
  assert.match(text, /will not overwrite newly saved settings or API keys/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
