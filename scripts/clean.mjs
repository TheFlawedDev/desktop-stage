#!/usr/bin/env node
/**
 * Cross-platform replacement for `rm -rf` in package clean scripts.
 *
 * Every caller passes targets relative to its own package directory, and this
 * script removes them relative to the directory it is run from. A target that
 * resolves outside that directory is refused, so a clean can never delete
 * anything outside the package that declared it.
 *
 * Usage: node ../../scripts/clean.mjs <path> [path...]
 * Paths may be plain names (`dist`) or a single `*.ext` pattern (`*.tsbuildinfo`).
 */

import { readdir, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const cwd = process.cwd();

/** The only wildcard form we accept, so nothing shell-specific is needed. */
const GLOB = /^\*(\.[A-Za-z0-9_-]+)+$/;

function resolveInside(name) {
  const target = resolve(cwd, name);
  const rel = relative(cwd, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`clean: refusing to remove "${name}" outside ${cwd}`);
  }
  return target;
}

async function expand(pattern) {
  if (!GLOB.test(pattern)) {
    throw new Error(
      `clean: unsupported pattern "${pattern}" (only "*.ext" is allowed)`,
    );
  }
  const suffix = pattern.slice(1);
  const entries = await readdir(cwd, { withFileTypes: true });
  return entries
    .filter((entry) => entry.name.endsWith(suffix))
    .map((entry) => entry.name);
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error(
    "clean: expected at least one path, e.g. node scripts/clean.mjs dist .turbo",
  );
  process.exit(1);
}

for (const name of targets) {
  const matches = name.includes("*") ? await expand(name) : [name];
  for (const match of matches) {
    await rm(resolveInside(match), { recursive: true, force: true });
  }
}
