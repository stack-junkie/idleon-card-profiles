import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameAdapter } from '../src/game-adapter.js';

function fixture() {
  const row = () => Array(12).fill('B');
  const attrs = {
    GetPlayersUsernames: ['First', 'Second'], UserInfo: ['First'],
    CardPreset: Array.from({ length: 7 }, row), Cards: [{ h: { frog: 12, slime: 5, boss: 0 } }, [], row(), { h: { Blunder: 42 } }],
    PlayerStuff: [0, 0, 0], GemItemsPurchased: Array(67).fill(0),
    CustomLists: { h: { CardStuff: [[['frog'], ['slime'], ['boss']]] } },
    Lv0: [50], PlayerDATABASE: { h: { First: { h: { Lv0: [50] } } } },
    MenuType: 3, OptionsList: Array(13).fill(0)
  };
  attrs.OptionsList[12] = 3;
  const calls = [];
  const ui = { wrapper: { enabled: true }, _UIinventoryOn7: [], _TriggerTEXT: 'previous', _customEvent_cardStuff() { calls.push(`redraw:${this._TriggerTEXT}`); } };
  ui._UIinventoryOn7[32] = ui._UIinventoryOn7[41] = 1;
  attrs.PixelHelperActor = [];
  attrs.PixelHelperActor[6] = { behaviors: { getBehavior: name => name === 'ActorEvents_312' ? ui : null } };
  const engine = { gameAttributes: { h: attrs }, getGameAttribute: name => attrs[name], isTransitioning: () => false, root: { localToGlobal: p => ({ x: p.x * 2 + 10, y: p.y * 2 + 20 }) } };
  const document = { querySelectorAll: () => [canvas] };
  const canvas = { ownerDocument: document, getBoundingClientRect: () => ({ left: 100, top: 50, width: 2000, height: 1200 }) };
  const root = {
    'com.stencyl.Engine': { engine, SCALE: 1, stage: { stageWidth: 2000, stageHeight: 1200 } },
    'scripts.ActorEvents_124': { _customBlock_TalentCalc: value => { calls.push(`stats:${value}`); return 123; } },
    'openfl.geom.Point': class Point { constructor(x, y) { this.x = x; this.y = y; } }
  };
  return { attrs, calls, ui, root, engine, document, adapter: createGameAdapter(root, { document }) };
}

test('active snapshot includes unswitched edits and does not alias game state', () => {
  const { attrs, adapter } = fixture();
  attrs.Cards[2][2] = 'frog';
  const state = adapter.getState();
  assert.equal(state.presets[0][2], 'frog');
  assert.equal(attrs.CardPreset[0][2], 'B');
  state.presets[0][2] = 'slime';
  assert.equal(attrs.Cards[2][2], 'frog');
  assert.deepEqual(state.ownedCards, ['frog', 'slime']);
  assert.equal(state.slotCount, 2);
  assert.equal(state.capacity, 4);
});

test('whole profile load synchronizes bank and equipped cards, redraws and recalculates, preserves bonus', () => {
  const { attrs, adapter, calls, ui } = fixture();
  const before = adapter.getState();
  const next = structuredClone(before.presets);
  next[0][3] = 'frog'; next[1][1] = 'slime';
  const set = attrs.Cards[3];
  const after = adapter.apply(next, before);
  assert.deepEqual(after.presets, next);
  assert.deepEqual(attrs.Cards[2], next[0]);
  assert.notEqual(attrs.Cards[2], attrs.CardPreset[0]);
  assert.deepEqual(calls, ['redraw:de', 'stats:-4']);
  assert.equal(ui._TriggerTEXT, 'previous');
  assert.equal(attrs.Cards[3], set);
  assert.deepEqual(set.h, { Blunder: 42 });
  // Simulate the native outgoing commit. It must preserve the newly loaded active slot.
  attrs.CardPreset[attrs.PlayerStuff[2]] = [...attrs.Cards[2]];
  assert.deepEqual(attrs.CardPreset, next);
});

test('validation rejects unowned, duplicate, locked and reserved slot changes before mutation', () => {
  const { adapter, calls } = fixture();
  const state = adapter.getState();
  for (const change of [p => { p[0][0] = 'boss'; }, p => { p[0][0] = 'unknown'; }, p => { p[0][0] = p[0][1] = 'frog'; }, p => { p[2][0] = 'frog'; }, p => { p[0][4] = 'frog'; }, p => p[0].pop()]) {
    const next = structuredClone(state.presets); change(next);
    assert.throws(() => adapter.apply(next, state));
    assert.deepEqual(adapter.getState(), state);
  }
  assert.deepEqual(calls, []);
});

test('load requires unchanged character, selected preset and all card state', () => {
  for (const change of [a => { a.UserInfo[0] = 'Second'; }, a => { a.PlayerStuff[2] = 1; }, a => { a.Cards[2][0] = 'frog'; }, a => { a.Cards[3].h.Blunder = 43; }, a => { a.MenuType = 0; }]) {
    const { adapter, attrs, calls } = fixture();
    const state = adapter.getState(); change(attrs);
    assert.throws(() => adapter.apply(state.presets, state));
    assert.deepEqual(calls, []);
  }
});

test('failed native refresh rolls back raw bank and active unswitched state', () => {
  const { adapter, attrs, ui } = fixture();
  attrs.Cards[2][1] = 'slime';
  const bank = attrs.CardPreset, equipped = attrs.Cards[2], set = attrs.Cards[3];
  const before = adapter.getState(), next = structuredClone(before.presets);
  next[0][0] = 'frog';
  ui._customEvent_cardStuff = () => { attrs.Cards[3].h.Blunder = 99; throw new Error('fixture failure'); };
  assert.throws(() => adapter.apply(next, before), /original cards restored/);
  assert.equal(attrs.CardPreset, bank);
  assert.equal(attrs.Cards[2], equipped);
  assert.equal(attrs.Cards[3], set);
  assert.deepEqual(set.h, { Blunder: 42 });
  assert.equal(attrs.CardPreset[0][1], 'B');
  assert.equal(attrs.Cards[2][1], 'slime');
  assert.deepEqual(adapter.getState(), before);
});

test('native bonus mutation without exception is detected and rolled back', () => {
  const { adapter, attrs, ui } = fixture();
  const before = adapter.getState();
  ui._customEvent_cardStuff = () => { attrs.Cards[3].h.Blunder = 99; };
  assert.throws(() => adapter.apply(before.presets, before), /card-set bonus/);
  assert.deepEqual(adapter.getState(), before);
});

test('raw active bank corruption cannot hide behind equipped snapshot overlay', () => {
  const { adapter, attrs, ui } = fixture();
  const before = adapter.getState(), next = structuredClone(before.presets);
  next[0][0] = 'slime';
  ui._customEvent_cardStuff = () => { attrs.CardPreset[0][0] = 'frog'; };
  assert.throws(() => adapter.apply(next, before), /readback did not match/);
  assert.deepEqual(adapter.getState(), before);
  assert.equal(attrs.CardPreset[0][0], 'B');
});

test('reads re-resolve character and UI objects, fail closed on missing structures', () => {
  const { adapter, attrs } = fixture();
  assert.equal(adapter.getState().context.accountId, 'roster:First');
  attrs.UserInfo[0] = 'Second';
  assert.equal(adapter.getState().context.characterId, '1:Second');
  attrs.PixelHelperActor[6] = null;
  assert.equal(adapter.getState().ready, false);
  adapter.destroy();
  assert.match(adapter.getState().error, /detached/);
});

test('anchor uses root transform and canvas CSS position, fails closed without geometry', () => {
  const { adapter, engine } = fixture();
  assert.deepEqual(adapter.getAnchor(), { left: 1468, top: 438, width: 506, height: 40, scale: 2 });
  engine.root = null;
  assert.equal(adapter.getAnchor(), null);
});

test('factory survives serialization without imported helpers', () => {
  const { root, document } = fixture();
  const factory = new Function(`return (${createGameAdapter.toString()});`)();
  assert.equal(factory(root, { document }).getState().ready, true);
});

function fontFixture() {
  const value = fixture();
  const rendered = [], drawCalls = [];
  let disposed = 0;
  value.root['com.stencyl.Engine'].SCALE = 2;
  value.root['com.stencyl.behavior.Script'] = { getFont(id) {
    assert.equal(id, 75);
    return {
      fontScale: 1, getTextWidth: text => text.length * 10, getHeight: () => 20,
      font: { containsCharacter: char => /^[ -~]$/.test(char), renderToImg: (...args) => rendered.push(args) }
    };
  } };
  value.root['openfl.display.BitmapData'] = class BitmapData {
    constructor(width, height, transparent, color) { this.width = width; this.height = height; this.image = { get_src: () => ({ width, height }) }; assert.equal(transparent, true); assert.equal(color, 0); }
    dispose() { disposed++; }
  };
  const context = { clearRect() {}, drawImage: (...args) => drawCalls.push(args) };
  const canvas = { style: {}, dataset: {}, ownerDocument: { defaultView: { devicePixelRatio: 2 } }, getContext: () => context };
  return { ...value, canvas, context, rendered, drawCalls, disposed: () => disposed };
}

test('native font preserves atlas rendering and scales native pixels to CSS and DPR', () => {
  const { adapter, canvas, context, rendered, drawCalls, disposed } = fontFixture();
  assert.equal(adapter.renderName(canvas, 'Mining', { scale: 3, maxWidth: 150 }), true);
  assert.equal(rendered[0][1], 'Mining');
  assert.equal(rendered[0][8], false);
  assert.equal(canvas.style.width, '90px');
  assert.equal(canvas.style.height, '30px');
  assert.equal(canvas.width, 180);
  assert.equal(canvas.height, 60);
  assert.equal(context.imageSmoothingEnabled, false);
  assert.deepEqual(drawCalls[0].slice(1), [0, 0, 180, 60]);
  assert.equal(disposed(), 1);
});

test('native names ellipsize to the available CSS width without dropping unsupported glyphs', () => {
  const { adapter, canvas, rendered } = fontFixture();
  assert.equal(adapter.renderName(canvas, 'Mining cards', { scale: 2, maxWidth: 70 }), true);
  assert.equal(rendered[0][1], 'Mini...');
  assert.equal(canvas.style.width, '70px');
  assert.throws(() => adapter.validateName('Mining😀'), /cannot display/);
  assert.equal(adapter.renderName(canvas, 'Mining😀', { scale: 2, maxWidth: 70 }), false);
  assert.equal(rendered.length, 1);
});

test('missing native font keeps fallback available and detached renderers fail closed', () => {
  const value = fixture();
  assert.equal(value.adapter.renderName({}, 'Mining'), false);
  assert.throws(() => value.adapter.validateName('Mining'), /unavailable/);
  const { adapter, canvas } = fontFixture();
  adapter.destroy();
  assert.equal(adapter.renderName(canvas, 'Mining'), false);
});

test('card labels use native card title definitions and fall back to identifiers', () => {
  const { adapter, attrs } = fixture();
  attrs.MonsterDefinitionsGET = { h: { frog: { h: { Name: 'Green_Frog' } } } };
  assert.equal(adapter.cardLabel('frog'), 'Green Frog');
  assert.equal(adapter.cardLabel('B'), 'Empty');
  assert.equal(adapter.cardLabel('unknown'), 'unknown');
  attrs.MonsterDefinitionsGET.h.frog.h.Name = 'Changed_Frog';
  assert.equal(adapter.cardLabel('frog'), 'Changed Frog');
  adapter.destroy();
  assert.equal(adapter.cardLabel('frog'), 'frog');
});

test('preferred canvas comes from native stage window backend, ignoring overlay canvases', () => {
  const { adapter, root, document } = fixture();
  document.querySelectorAll = () => { throw new Error('Fallback should not run.'); };
  root['com.stencyl.Engine'].stage.window = { __backend: { canvas: { ownerDocument: document, getBoundingClientRect: () => ({ left: 0, top: 0, width: 2000, height: 1200 }) } } };
  assert.deepEqual(adapter.getAnchor(), { left: 1368, top: 388, width: 506, height: 40, scale: 2 });
});
