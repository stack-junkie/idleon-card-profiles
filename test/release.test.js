import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

test('release guard validates staged content and rejects unversioned material changes', async t => {
  const parent = tmpdir();
  const root = await mkdtemp(path.join(parent, 'idleon-release-test-'));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(parent)); await rm(root, { recursive: true, force: true }); });
  await mkdir(path.join(root, 'src')); await mkdir(path.join(root, 'scripts'));
  await writeFile(path.join(root, 'scripts/check-release.mjs'), await readFile(new URL('../scripts/check-release.mjs', import.meta.url)));
  const files = {
    'src/version.js': "export const VERSION = '0.1.0';\n", VERSION: '0.1.0\n',
    'package.json': '{"version":"0.1.0"}', 'README.md': '# Fixture 0.1.0',
    'CHANGELOG.md': '# Changes\n\n## [0.1.0]\n\nInitial fixture.\n', 'src/app.js': 'export const value = 1;\n',
  };
  for (const [name, body] of Object.entries(files)) await writeFile(path.join(root, name), body);
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete env[key];
  const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' });
  const check = mode => spawnSync(process.execPath, ['scripts/check-release.mjs', mode], { cwd: root, env, encoding: 'utf8' });
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  git('add', '--', ...Object.keys(files), 'scripts/check-release.mjs');
  assert.equal(check('--staged').status, 0);
  git('commit', '-m', 'Initial fixture');
  assert.equal(check('--head').status, 0);
  await writeFile(path.join(root, 'src/app.js'), 'export const value = 2;\n'); git('add', '--', 'src/app.js');
  assert.match(check('--staged').stderr, /version bump/);
  for (const name of ['src/version.js', 'VERSION', 'package.json', 'README.md', 'CHANGELOG.md']) {
    await writeFile(path.join(root, name), files[name].replaceAll('0.1.0', '0.1.1'));
  }
  assert.match(check('--staged').stderr, /version bump/, 'unstaged metadata must not satisfy staged checks');
  git('add', '--', 'src/version.js', 'VERSION', 'package.json', 'README.md', 'CHANGELOG.md');
  assert.equal(check('--staged').status, 0);
  await writeFile(path.join(root, 'VERSION'), '0.1.2\n'); git('add', '--', 'VERSION');
  assert.match(check('--staged').stderr, /Version files differ/);
});
