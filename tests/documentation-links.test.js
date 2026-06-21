import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const latestPortableUrl =
  "https://github.com/wangzhezbz/codex-bridge/releases/latest/download/CodexBridge-Windows-x64-Portable.zip";
const latestMacArm64Url =
  "https://github.com/wangzhezbz/codex-bridge/releases/latest/download/CodexBridge-macOS-arm64-Portable.zip";
const latestMacX64Url =
  "https://github.com/wangzhezbz/codex-bridge/releases/latest/download/CodexBridge-macOS-x64-Portable.zip";

test("public docs use the stable latest Windows download link", () => {
  for (const file of ["README.md", path.join("docs", "windows-portable.md"), path.join("docs", "releases.md")]) {
    const text = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    assert.match(text, new RegExp(escapeRegExp(latestPortableUrl)), `${file} should link latest portable build`);
    assert.doesNotMatch(text, /CodexBridge-windows-portable/i, `${file} should not use the old package name`);
  }
});

test("public docs use stable latest macOS download links", () => {
  for (const file of ["README.md", path.join("docs", "macos-portable.md"), path.join("docs", "releases.md")]) {
    const text = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    assert.match(text, new RegExp(escapeRegExp(latestMacArm64Url)), `${file} should link latest macOS arm64 build`);
    assert.match(text, new RegExp(escapeRegExp(latestMacX64Url)), `${file} should link latest macOS x64 build`);
  }
});

test("user-facing docs separate Win users and Mac users", () => {
  for (const file of [
    "README.md",
    path.join("docs", "windows-portable.md"),
    path.join("docs", "macos-portable.md"),
    path.join("docs", "releases.md"),
    path.join("docs", "windows-setup.md"),
  ]) {
    const text = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    assert.match(text, /Win 用户|Win users/, `${file} should name Win users`);
    assert.match(text, /Mac 用户|Mac users/, `${file} should name Mac users`);
    assert.doesNotMatch(text, /普通用户|Normal users/i, `${file} should not say normal users`);
    assert.doesNotMatch(text, /高级用户|Advanced users/i, `${file} should not say advanced users`);
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

test("macOS portable docs explain stable user data storage and first launch", () => {
  const text = fs.readFileSync(
    path.join(process.cwd(), "docs", "macos-portable.md"),
    "utf8",
  );

  assert.match(text, /~\/Library\/Application Support\/CodexBridge/);
  assert.match(text, /right-click/);
  assert.match(text, /Control-click/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
