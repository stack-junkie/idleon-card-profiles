import { createProfileController } from '/src/controller.js';
import { mountOverlay } from '/src/ui.js';

const token = location.hash.slice(1);
const stage = document.getElementById('stage');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const clone = value => structuredClone(value);
const names = ['Archer', 'Mage'];
const blank = () => Array(12).fill('B');
const characters = Object.fromEntries(names.map((name, index) => [name, { selected: 0, presets: Array.from({ length: 7 }, blank), equipped: [index ? 'frog' : 'mushroom', 'bean', 'B', 'B', 'B', 'B', 'B', 'B', 'B', 'B', 'B', 'B'] }]));
let character = names[0]; let visible = true; let nativeFont = null; let lastDraw = '';
const cardLabels = { mushroom: 'Green Mushroom', bean: 'Bean', frog: 'Frog', slime: 'Slime', B: 'Empty' };
const rpc = async (method, params) => {
  const response = await fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ method, params }) });
  const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Preview helper failed.'); return payload.result;
};
try {
  const response = await fetch('/font.fnt'); if (!response.ok) throw new Error('Font unavailable');
  const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
  const glyphs = new Map([...xml.querySelectorAll('char')].map(node => [Number(node.getAttribute('id')), Object.fromEntries([...node.attributes].map(attr => [attr.name, Number(attr.value)]))]));
  const atlas = new Image(); atlas.src = '/font.png'; await atlas.decode();
  nativeFont = { glyphs, atlas, height: Number(xml.querySelector('common').getAttribute('lineHeight')) };
} catch { document.getElementById('notice').textContent = 'Native font unavailable; using text fallback.'; }

function renderFont(target, text, { scale = 1, maxWidth = 600 } = {}) {
  if (!nativeFont || [...text].some(char => !nativeFont.glyphs.has(char.codePointAt(0)))) return false;
  const widthOf = value => [...value].reduce((sum, char) => sum + nativeFont.glyphs.get(char.codePointAt(0)).xadvance, 0);
  let display = text;
  while (display && widthOf(display) * scale > maxWidth) { const base = display.endsWith('...') ? display.slice(0, -3) : display; display = [...base].slice(0, -1).join('') + '...'; if (base.length < 2) break; }
  const width = Math.min(maxWidth, widthOf(display) * scale), height = nativeFont.height * scale;
  const dpr = devicePixelRatio || 1; target.width = Math.max(1, Math.ceil(width * dpr)); target.height = Math.ceil(height * dpr);
  target.style.width = `${width}px`; target.style.height = `${height}px`;
  const out = target.getContext('2d'); out.imageSmoothingEnabled = false; out.scale(scale * dpr, scale * dpr);
  let x = 0;
  for (const char of display) { const g = nativeFont.glyphs.get(char.codePointAt(0)); out.drawImage(nativeFont.atlas, g.x, g.y, g.width, g.height, x + g.xoffset, g.yoffset, g.width, g.height); x += g.xadvance; }
  return true;
}

function state() {
  const current = characters[character]; const bank = clone(current.presets); bank[current.selected] = clone(current.equipped);
  return { ready: true, visible, context: { accountId: 'offline-preview', characterId: `sample:${character}`, characterName: character }, selected: current.selected, slotCount: 7, capacity: 8, ownedCards: Object.keys(cardLabels).filter(id => id !== 'B'), presets: bank, cardSet: { unchanged: 1 } };
}
const adapter = {
  getState: state,
  getAnchor() { const rect = canvas.getBoundingClientRect(), scale = rect.width / 960; return { left: rect.left + 679 * scale, top: rect.top + 184 * scale, width: 253 * scale, height: 20 * scale, scale }; },
  validate(bank, before) {
    if (!Array.isArray(bank) || bank.length !== 7) throw new Error('Invalid complete bank.');
    bank.forEach(row => { if (row.length !== 12 || row.slice(0, 8).some(id => !Object.hasOwn(cardLabels, id))) throw new Error('Unknown preview card.'); const equipped = row.slice(0, 8).filter(id => id !== 'B'); if (new Set(equipped).size !== equipped.length) throw new Error('Duplicate card.'); });
    return true;
  },
  apply(bank, before) {
    if (JSON.stringify(before) !== JSON.stringify(state())) throw new Error('The character or cards changed.');
    this.validate(bank, before); characters[character].presets = clone(bank); characters[character].equipped = clone(bank[before.selected]); draw(); return state();
  },
  renderName: renderFont,
  cardLabel: id => cardLabels[id] || id,
  validateName(text) { if (nativeFont && [...text].some(char => !nativeFont.glyphs.has(char.codePointAt(0)))) throw new Error('This name contains a character the native font cannot display.'); },
  destroy() {},
};
const controller = createProfileController(adapter, rpc);
const ui = mountOverlay(controller);
document.getElementById('character').addEventListener('change', event => { character = event.target.value; draw(); controller.refresh(); });
document.getElementById('menu').addEventListener('change', event => { visible = event.target.checked; draw(); controller.refresh(); });
document.getElementById('swap').addEventListener('click', () => { const current = characters[character]; current.equipped[0] = current.equipped[0] === 'slime' ? 'mushroom' : 'slime'; draw(); controller.refresh(); });

function box(x, y, w, h, color = '#484848') { ctx.fillStyle = '#151515'; ctx.fillRect(x, y, w, h); ctx.fillStyle = '#a5a5a5'; ctx.fillRect(x + 2, y + 2, w - 4, h - 4); ctx.fillStyle = '#6b6b6b'; ctx.fillRect(x + 4, y + 4, w - 8, h - 8); ctx.fillStyle = color; ctx.fillRect(x + 6, y + 6, w - 12, h - 12); }
function text(value, x, y, size = 15, color = '#eee') { ctx.font = `bold ${size}px monospace`; ctx.lineWidth = 3; ctx.strokeStyle = '#222'; ctx.strokeText(value, x, y); ctx.fillStyle = color; ctx.fillText(value, x, y); }
function draw() {
  ctx.clearRect(0, 0, 960, 540); const current = state();
  document.getElementById('equipped-state').textContent = `${character}, preset ${current.selected + 1}: ${current.presets[current.selected].slice(0, 8).map(id => cardLabels[id]).join(', ')}`;
  text('OFFLINE MENU RECONSTRUCTION', 24, 42, 16, '#e9f3ef'); text(character, 24, 68, 15, '#e9f3ef');
  const presetRoot = document.getElementById('native-presets'); presetRoot.replaceChildren();
  if (!visible) { text('Cards panel closed', 350, 260, 25); return; }
  box(393, 65, 559, 470); box(661, 128, 283, 351);
  ['QUESTS', 'HINTS', 'QUICK REF', 'CARDS', 'FAMILY', 'FRIENDS', 'GUILD'].forEach((label, i) => { box(403 + i * 77, 76, 70, 45, i === 3 ? '#777' : '#373737'); text(label, 408 + i * 77, 108, 11); });
  text('CARD COLLECTION', 717, 151, 20); text('Double click a card to equip it!', 683, 177, 11, '#e9c48e');
  ctx.strokeStyle = '#acbea0'; ctx.beginPath(); ctx.moveTo(678, 211); ctx.lineTo(934, 211); ctx.stroke(); text('Presets', 779, 216, 15, '#d9b8ea');
  const colors = ['#358654', '#98824b', '#517d9c', '#9865a0', '#82986c', '#936249', '#63cc8b'];
  for (let index = 0; index < 7; index++) {
    box(687 + index * 36, 225, 24, 27, colors[index]); text(String(index + 1), 694 + index * 36, 244, 13);
    if (index === current.selected) { ctx.strokeStyle = '#e9f3d7'; ctx.lineWidth = 2; ctx.strokeRect(688 + index * 36, 226, 22, 25); }
    const button = document.createElement('button'); button.className = 'native-hit'; button.type = 'button'; button.setAttribute('aria-label', `Select preset ${index + 1}`); button.style.cssText = `left:${(687 + index * 36) / 9.6}%;top:${225 / 5.4}%;width:${24 / 9.6}%;height:${27 / 5.4}%`;
    button.addEventListener('click', () => { const char = characters[character]; char.presets[char.selected] = clone(char.equipped); char.selected = index; char.equipped = clone(char.presets[index]); draw(); controller.refresh(); }); presetRoot.append(button);
  }
  text('EQUIPPED CARDS', 674, 284, 20);
  current.presets[current.selected].slice(0, 8).forEach((id, i) => { const x = 674 + (i % 4) * 68, y = 294 + Math.floor(i / 4) * 94; box(x, y, 59, 81, id === 'B' ? '#191919' : '#526c52'); if (id !== 'B') { text(cardLabels[id].split(' ').at(-1), x + 8, y + 38, 10, '#eee7be'); text('CARD', x + 13, y + 57, 11); } });
  ['BLUNDER HILLS', 'YUM-YUM DESERT', 'EASY RESOURCES'].forEach((group, i) => { box(399, 130 + i * 120, 256, 114, ['#166b37', '#80511b', '#456a27'][i]); text(group, 408, 153 + i * 120, 18, '#e4c187'); for (let j = 0; j < 8; j++) box(409 + j * 29, 165 + i * 120, 26, 61, ['#699b45', '#8b8647', '#4f9744'][i]); });
}
draw();
window.addEventListener('resize', () => controller.refresh());
window.addEventListener('beforeunload', () => { ui.destroy(); controller.destroy(); });
