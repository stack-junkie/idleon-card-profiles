import { createHash, randomUUID } from 'node:crypto';

export const SCHEMA_VERSION = 1;
const fail = message => { throw new Error(message); };
export const copy = value => structuredClone(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const bounded = (value, max, label) => {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) fail(`Invalid ${label}.`);
  return value;
};

export function normalizeName(value) {
  if (typeof value !== 'string') fail('A preset name must be text.');
  const name = value.trim();
  if ([...name].length > 32) fail('Preset names can contain at most 32 characters.');
  if (/[\u0000-\u001f\u007f]/u.test(name)) fail('Preset names cannot contain line breaks or control characters.');
  return name;
}

export function normalizeTitle(value) {
  if (typeof value !== 'string') fail('Enter a profile title.');
  const title = value.trim();
  if (!title || [...title].length > 64 || /[\u0000-\u001f\u007f]/u.test(title)) fail('Use a profile title between 1 and 64 characters.');
  return title;
}

export function contextKeys(context) {
  if (!plain(context)) fail('No character is selected.');
  const account = bounded(context.accountId, 256, 'account identity');
  const character = bounded(context.characterId, 256, 'character identity');
  bounded(context.characterName, 128, 'character name');
  const hash = value => createHash('sha256').update(value).digest('hex');
  return { account: hash(account), character: hash(character) };
}

export function validateBank(bank, max = 32) {
  if (!Array.isArray(bank) || !bank.length || bank.length > max) fail('Invalid preset bank.');
  for (const cards of bank) {
    if (!Array.isArray(cards) || cards.length < 4 || cards.length > 64) fail('Invalid card arrangement.');
    cards.forEach(card => bounded(card, 96, 'card identifier'));
  }
}

export function validateSnapshot(snapshot) {
  if (!plain(snapshot) || snapshot.ready !== true) fail('The Cards screen is not ready.');
  contextKeys(snapshot.context);
  if (!Number.isInteger(snapshot.slotCount) || snapshot.slotCount < 2 || snapshot.slotCount > 7) fail('Unsupported number of presets.');
  if (!Number.isInteger(snapshot.capacity) || snapshot.capacity < 4 || snapshot.capacity > 8) fail('Unsupported card capacity.');
  if (!Number.isInteger(snapshot.selected) || snapshot.selected < 0 || snapshot.selected >= snapshot.slotCount) fail('Invalid selected preset.');
  validateBank(snapshot.presets);
  if (snapshot.presets.length < snapshot.slotCount || snapshot.presets.some(cards => cards.length < snapshot.capacity)) fail('Incomplete native preset bank.');
  return snapshot;
}

export function portableProfile(snapshot, names, title, id = randomUUID()) {
  validateSnapshot(snapshot);
  const profile = {
    id,
    title: normalizeTitle(title),
    sourceCharacterName: snapshot.context.characterName,
    savedAt: new Date().toISOString(),
    slotCount: snapshot.slotCount,
    capacity: snapshot.capacity,
    presets: snapshot.presets.slice(0, snapshot.slotCount).map((cards, i) => ({ name: normalizeName(names[i] ?? ''), cards: cards.slice(0, snapshot.capacity) })),
  };
  validateProfile(profile);
  return profile;
}

export function validateProfile(profile) {
  if (!plain(profile)) fail('Invalid profile.');
  bounded(profile.id, 100, 'profile ID');
  if (normalizeTitle(profile.title) !== profile.title) fail('Invalid profile title.');
  bounded(profile.sourceCharacterName, 128, 'source character');
  if (typeof profile.savedAt !== 'string' || !Number.isFinite(Date.parse(profile.savedAt))) fail('Invalid profile date.');
  if (!Number.isInteger(profile.slotCount) || profile.slotCount < 2 || profile.slotCount > 7) fail('Unsupported profile preset count.');
  if (!Number.isInteger(profile.capacity) || profile.capacity < 4 || profile.capacity > 8) fail('Unsupported profile card capacity.');
  if (!Array.isArray(profile.presets) || profile.presets.length !== profile.slotCount) fail('The profile has an incomplete preset row.');
  for (const entry of profile.presets) {
    if (!plain(entry) || normalizeName(entry.name) !== entry.name || !Array.isArray(entry.cards) || entry.cards.length !== profile.capacity) fail('Invalid saved preset.');
    const seen = new Set();
    for (const card of entry.cards) {
      bounded(card, 96, 'card identifier');
      if (card !== 'B' && seen.has(card)) fail('A saved preset contains a duplicate card.');
      if (card !== 'B') seen.add(card);
    }
  }
  return profile;
}

export function mergeProfile(profile, snapshot) {
  validateProfile(profile);
  validateSnapshot(snapshot);
  if (profile.slotCount !== snapshot.slotCount || profile.capacity !== snapshot.capacity) {
    fail(`This profile needs ${profile.slotCount} presets and ${profile.capacity} card slots; this character currently has ${snapshot.slotCount} and ${snapshot.capacity}. Nothing was loaded.`);
  }
  const bank = copy(snapshot.presets);
  profile.presets.forEach((entry, index) => bank[index].splice(0, snapshot.capacity, ...entry.cards));
  return { presets: bank, names: profile.presets.map(entry => entry.name) };
}

export function recoverySnapshot(snapshot, names) {
  validateSnapshot(snapshot);
  return { slotCount: snapshot.slotCount, capacity: snapshot.capacity, presets: copy(snapshot.presets), names: names.map(normalizeName), savedAt: new Date().toISOString() };
}

export function sameBank(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

export function parseLibrary(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 16 * 1024 * 1024) fail('Choose a library file smaller than 16 MB.');
  let parsed;
  try { parsed = JSON.parse(text); } catch { fail('This is not a valid JSON library file.'); }
  if (!plain(parsed) || parsed.format !== 'idleon-card-profiles' || parsed.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.profiles) || parsed.profiles.length > 500) fail('Unsupported profile library format.');
  parsed.profiles.forEach(validateProfile);
  // Whitelist fields. Never import account assignments, recovery state, or executable content.
  return parsed.profiles.map(profile => ({
    id: randomUUID(), title: profile.title, sourceCharacterName: profile.sourceCharacterName,
    savedAt: profile.savedAt, slotCount: profile.slotCount, capacity: profile.capacity,
    presets: profile.presets.map(({ name, cards }) => ({ name, cards: [...cards] })),
  }));
}
