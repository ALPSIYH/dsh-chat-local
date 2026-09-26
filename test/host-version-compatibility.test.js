import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const modules = process.env.DSH_MODULES_DIR;

test('the native host accepts the verified version and rejects unsupported host generations', {
  skip: !modules && 'set DSH_MODULES_DIR to run native compatibility checks',
}, async () => {
  const { evaluatePluginCompatibility } = await import(pathToFileURL(join(modules, '@deepseek-ai/dsh-app-boot/lib/index.js')));
  assert.equal(evaluatePluginCompatibility(manifest, {}, '0.1.7-rc.2'), undefined);
  for (const version of ['0.1.4', '0.1.5-rc.2', '0.1.7-rc.1', '0.1.8-alpha.1', '0.2.0']) {
    const result = evaluatePluginCompatibility(manifest, {}, version);
    assert.ok(result, `host ${version} must be rejected before mounting the plugin`);
    assert.equal(result.exempted, false);
  }
});

test('native and third-party installers share one range without installing a second host', () => {
  assert.equal(manifest.peerDependencies?.['@deepseek-ai/dsh'], manifest.dsh.engines.dsh);
  assert.equal(manifest.peerDependenciesMeta?.['@deepseek-ai/dsh']?.optional, true);
});
