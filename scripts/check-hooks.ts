#!/usr/bin/env bun
/**
 * Checks that all hook events documented at code.claude.com are present in
 * our local config files. Exits with code 1 if any are missing.
 *
 * Usage: bun scripts/check-new-hooks.ts
 */

const HOOKS_DOC_URL = 'https://code.claude.com/docs/en/hooks.md';

const FILES_TO_CHECK = ['.claude/settings.json', 'hooks/hooks.json', 'settings.template.json'];

// ---------------------------------------------------------------------------
// Fetch & parse documented hooks
// ---------------------------------------------------------------------------

async function fetchDocumentedHooks(): Promise<string[]> {
  const res = await fetch(HOOKS_DOC_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${HOOKS_DOC_URL}: ${res.status} ${res.statusText}`);
  }
  const md = await res.text();

  // The lifecycle table has rows like: | `HookName` | description |
  // Extract PascalCase names wrapped in backticks in the first column.
  const hooks = new Set<string>();
  for (const line of md.split('\n')) {
    const match = line.match(/^\|\s*`([A-Z][A-Za-z]+)`\s*\|/);
    if (match) {
      hooks.add(match[1]);
    }
  }

  if (hooks.size === 0) {
    throw new Error(
      'Could not parse any hook names from the docs page. The markdown format may have changed.',
    );
  }

  return [...hooks];
}

// ---------------------------------------------------------------------------
// Read local config and extract hook keys
// ---------------------------------------------------------------------------

async function readHookKeys(path: string): Promise<string[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    console.warn(`  ⚠  ${path} not found, skipping`);
    return [];
  }
  const json = await file.json();
  return Object.keys(json.hooks ?? {});
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Fetching documented hooks from ${HOOKS_DOC_URL} …`);
  const documented = await fetchDocumentedHooks();
  console.log(`Found ${documented.length} documented hooks\n`);

  let hasMissing = false;

  for (const filePath of FILES_TO_CHECK) {
    const localHooks = await readHookKeys(filePath);
    if (localHooks.length === 0) continue;

    const missing = documented.filter((h) => !localHooks.includes(h));
    const unsupported = localHooks.filter((h) => !documented.includes(h));

    if (missing.length > 0) {
      hasMissing = true;
      console.error(`✗ ${filePath} is missing ${missing.length} hook(s):`);
      for (const h of missing) {
        console.error(`    - ${h}`);
      }
    }

    if (unsupported.length > 0) {
      hasMissing = true;
      console.error(`✗ ${filePath} has ${unsupported.length} unsupported hook(s):`);
      for (const h of unsupported) {
        console.error(`    - ${h}`);
      }
    }

    if (missing.length === 0 && unsupported.length === 0) {
      console.log(`✓ ${filePath} — all hooks present and valid`);
    }
  }

  if (hasMissing) {
    console.error('\nOne or more files have missing or unsupported hooks. Please update them.');
    process.exit(1);
  }

  console.log('\nAll files are up to date.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
