import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const mode = process.argv[2];
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ref = mode === '--staged' ? ':' : mode === '--head' ? 'HEAD:' : null;
const read = name => ref ? git('show', ref + name) : fs.readFileSync(name, 'utf8');
try {
  const version = read('src/version.js').match(/export const VERSION = ['"]([^'"]+)['"]/u)?.[1];
  if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u.test(version)) throw new Error('Invalid code version.');
  if (read('VERSION').trim() !== version || JSON.parse(read('package.json')).version !== version) throw new Error('Version files differ. Run npm run version:bump -- <version>.');
  if (!read('README.md').includes(version)) throw new Error('README must state the current version.');
  if (!read('CHANGELOG.md').includes(`## [${version}]`)) throw new Error('CHANGELOG needs an entry for this version.');
  if (read('CHANGELOG.md').includes('Describe the user-visible changes before committing.')) throw new Error('Complete the changelog entry before committing.');
  if (ref) {
    let base;
    try { base = git('rev-parse', '--verify', mode === '--staged' ? 'HEAD' : 'HEAD^'); } catch { /* First commit has no predecessor. */ }
    if (base) {
      const changes = mode === '--staged' ? git('diff', '--cached', '--name-only', base) : git('diff', '--name-only', base, 'HEAD');
      if (changes.split('\n').some(name => /^(src\/|preview\/|packaging\/|scripts\/build-installer\.ps1|Start-CardProfiles)/u.test(name))) {
        if (JSON.parse(git('show', `${base}:package.json`)).version === version) throw new Error('Material changes need a version bump.');
        const changelogChanged = changes.split('\n').includes('CHANGELOG.md');
        if (!changelogChanged) throw new Error('Material changes need a CHANGELOG entry.');
      }
    }
  }
  console.log(`Release metadata consistent: ${version}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
