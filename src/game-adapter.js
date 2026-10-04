// Keep this factory self-contained: the launcher serializes it into the game frame.
export function createGameAdapter(gameRoot, options = {}) {
  let destroyed = false;
  const copy = value => JSON.parse(JSON.stringify(value));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const integer = (value, min, max) => Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max;

  function resolve() {
    assert(!destroyed, 'Adapter is detached.');
    const Engine = gameRoot?.['com.stencyl.Engine'];
    const engine = Engine?.engine;
    const stats = gameRoot?.['scripts.ActorEvents_124'];
    assert(engine && typeof engine.getGameAttribute === 'function', 'Game engine is unavailable.');
    assert(typeof stats?._customBlock_TalentCalc === 'function', 'Native card stat refresh is unavailable.');
    const get = name => engine.getGameAttribute(name);
    const behavior = get('PixelHelperActor')?.[6]?.behaviors?.getBehavior?.('ActorEvents_312');
    assert(behavior && typeof behavior._customEvent_cardStuff === 'function', 'Cards interface is unavailable.');
    assert(!engine.isTransitioning?.(), 'Character or scene is changing.');
    return { Engine, engine, stats, behavior, get };
  }

  function read(resolved) {
    const { get, behavior } = resolved;
    const roster = get('GetPlayersUsernames');
    const characterName = get('UserInfo')?.[0];
    assert(Array.isArray(roster) && typeof roster[0] === 'string' && roster[0].length > 0, 'Account roster is unavailable.');
    assert(typeof characterName === 'string' && roster.indexOf(characterName) >= 0, 'Current character is unavailable.');
    const characterIndex = roster.indexOf(characterName);
    assert(roster.lastIndexOf(characterName) === characterIndex, 'Character identity is ambiguous.');
    const bank = get('CardPreset');
    const cards = get('Cards');
    const selected = Number(get('PlayerStuff')?.[2]);
    const purchases = get('GemItemsPurchased');
    const slotCount = 2 + Number(purchases?.[66]);
    const capacity = 4 + Number(purchases?.[63]);
    assert(Array.isArray(bank) && bank.length === 7, 'Unsupported native preset bank.');
    assert(integer(slotCount, 2, 7) && integer(capacity, 4, 8), 'Unsupported card or preset capacity.');
    assert(integer(selected, 0, slotCount - 1), 'Selected card preset is invalid.');
    assert(Array.isArray(cards) && cards[0]?.h && Array.isArray(cards[2]) && cards[3]?.h, 'Card state is unavailable.');
    const presets = copy(bank);
    presets[selected] = copy(cards[2]);
    assert(presets.every(row => Array.isArray(row) && row.length >= capacity && row.length <= 32 && row.every(id => typeof id === 'string')), 'Unsupported card preset structure.');
    const definitions = get('CustomLists')?.h?.CardStuff;
    assert(Array.isArray(definitions), 'Card definitions are unavailable.');
    const known = new Set(definitions.flatMap(group => Array.isArray(group) ? group.map(row => row?.[0]).filter(id => typeof id === 'string' && id !== 'Blank') : []));
    assert(known.size > 0, 'Card definitions are empty.');
    const ownedCards = Object.keys(cards[0].h).filter(id => known.has(id) && Number(cards[0].h[id]) > 0).sort();
    const firstLevel = get('PlayerDATABASE')?.h?.[roster[0]]?.h?.Lv0?.[0];
    const unlocked = Number(get('Lv0')?.[0]) > 29 || Number(firstLevel) > 29;
    const visible = unlocked && behavior.wrapper?.enabled === true && Number(get('MenuType')) === 3 && Number(get('OptionsList')?.[12]) === 3 && behavior._UIinventoryOn7?.[32] === 1 && behavior._UIinventoryOn7?.[41] === 1;
    return {
      ready: true, visible,
      // Non-secret local namespace. A renamed first character requires explicit data migration.
      context: { accountId: `roster:${roster[0]}`, characterId: `${characterIndex}:${characterName}`, characterName },
      selected, slotCount, capacity, ownedCards, presets, cardSet: copy(cards[3].h)
    };
  }

  function getState() {
    try { return read(resolve()); }
    catch (error) { return { ready: false, visible: false, error: error.message }; }
  }

  function validate(presets, state = getState()) {
    assert(state?.ready, state?.error || 'Game state is unavailable.');
    assert(Array.isArray(presets) && presets.length === state.presets.length, 'Profile must preserve the complete native preset bank.');
    const owned = new Set(state.ownedCards);
    for (let index = 0; index < presets.length; index++) {
      const row = presets[index];
      const original = state.presets[index];
      assert(Array.isArray(row) && row.length === original.length, `Preset ${index + 1} has an unsupported shape.`);
      if (index >= state.slotCount) {
        assert(same(row, original), `Preset ${index + 1} is locked.`);
        continue;
      }
      assert(same(row.slice(state.capacity), original.slice(state.capacity)), `Preset ${index + 1} changes reserved or locked card slots.`);
      const seen = new Set();
      for (const id of row.slice(0, state.capacity)) {
        assert(typeof id === 'string', `Preset ${index + 1} contains an invalid card.`);
        if (id === 'B') continue;
        assert(owned.has(id), `Preset ${index + 1} contains an unknown or unowned card: ${id}.`);
        assert(!seen.has(id), `Preset ${index + 1} contains duplicate card: ${id}.`);
        seen.add(id);
      }
    }
    return true;
  }

  function signature(state) {
    return JSON.stringify([state.context, state.selected, state.slotCount, state.capacity, state.ownedCards, state.presets, state.cardSet]);
  }

  function apply(presets, expectedState) {
    const resolved = resolve();
    const before = read(resolved);
    assert(before.visible && expectedState?.ready && expectedState.visible, 'Open the main Cards panel before loading a profile.');
    assert(signature(before) === signature(expectedState), 'Character or card state changed. Preview the profile again.');
    validate(presets, before);
    const next = copy(presets);
    const { engine, get, behavior, stats } = resolved;
    assert(engine.gameAttributes?.h, 'Native game attribute storage is unavailable.');
    const oldBank = get('CardPreset');
    const oldBankData = copy(oldBank);
    const cards = get('Cards');
    const oldEquipped = cards[2];
    const oldEquippedData = copy(oldEquipped);
    const oldCardSet = cards[3];
    const oldBonus = copy(oldCardSet.h);
    const oldTrigger = behavior._TriggerTEXT;
    function refresh() {
      behavior._TriggerTEXT = 'de';
      behavior._customEvent_cardStuff();
      engine.gameAttributes.h.DummyNumber4 = stats._customBlock_TalentCalc(-4);
    }
    function restoreBonus() {
      cards[3] = oldCardSet;
      for (const key of Object.keys(oldCardSet.h)) delete oldCardSet.h[key];
      Object.assign(oldCardSet.h, copy(oldBonus));
    }
    try {
      engine.gameAttributes.h.CardPreset = next;
      cards[2] = copy(next[before.selected]);
      refresh();
      const after = read(resolve());
      assert(cards[3] === oldCardSet && same(after.cardSet, before.cardSet), 'Native refresh changed the card-set bonus.');
      assert(same(after.context, before.context) && after.selected === before.selected && same(after.presets, presets) && same(get('CardPreset'), presets) && same(get('Cards')[2], presets[before.selected]), 'Native profile readback did not match.');
      return after;
    } catch (error) {
      engine.gameAttributes.h.CardPreset = oldBank;
      cards[2] = oldEquipped;
      oldBank.splice(0, oldBank.length, ...copy(oldBankData));
      oldEquipped.splice(0, oldEquipped.length, ...oldEquippedData);
      restoreBonus();
      let rollbackError;
      try { refresh(); } catch (failure) { rollbackError = failure; }
      // Even a failed native refresh must not leave the data model partly replaced.
      engine.gameAttributes.h.CardPreset = oldBank;
      cards[2] = oldEquipped;
      oldBank.splice(0, oldBank.length, ...copy(oldBankData));
      oldEquipped.splice(0, oldEquipped.length, ...oldEquippedData);
      restoreBonus();
      throw new Error(`Profile load failed; original cards restored. ${error.message}${rollbackError ? ` Native display refresh also failed: ${rollbackError.message}` : ''}`);
    } finally {
      behavior._TriggerTEXT = oldTrigger;
    }
  }

  function getAnchor() {
    try {
      const { Engine, engine } = resolve();
      const document = options.document || globalThis.document;
      const stage = Engine.stage;
      const root = engine.root;
      const Point = gameRoot['openfl.geom.Point'];
      assert(document && stage && typeof root?.localToGlobal === 'function' && Point, 'Game geometry is unavailable.');
      let canvas = stage.window?.__backend?.canvas;
      if (!canvas) {
        const candidates = Array.from(document.querySelectorAll('canvas')).filter(item => { const rect = item.getBoundingClientRect(); return item.dataset?.idleonCardPresetsFont !== 'true' && rect.width > 0 && rect.height > 0; });
        assert(candidates.length === 1, 'Game canvas is ambiguous.');
        canvas = candidates[0];
      }
      assert(canvas.ownerDocument === document, 'Game canvas belongs to a different frame.');
      const rect = canvas.getBoundingClientRect();
      const stageWidth = Number(stage.stageWidth), stageHeight = Number(stage.stageHeight);
      const assetScale = Number(Engine.SCALE);
      assert([rect.width, rect.height, stageWidth, stageHeight, assetScale].every(value => Number.isFinite(value) && value > 0), 'Invalid game scale.');
      const start = root.localToGlobal(new Point(679 * assetScale, 184 * assetScale));
      const end = root.localToGlobal(new Point(932 * assetScale, 204 * assetScale));
      const width = (end.x - start.x) * rect.width / stageWidth;
      const height = (end.y - start.y) * rect.height / stageHeight;
      const scale = width / 253;
      assert(Number.isFinite(scale) && scale > 0 && Math.abs(height / 20 - scale) < scale * 0.02, 'Unsupported game transform.');
      return { left: rect.left + start.x * rect.width / stageWidth, top: rect.top + start.y * rect.height / stageHeight, width, height, scale };
    } catch { return null; }
  }

  function nativeFont() {
    assert(!destroyed, 'Adapter is detached.');
    const font = gameRoot?.['com.stencyl.behavior.Script']?.getFont?.(75);
    assert(font?.font && typeof font.font.containsCharacter === 'function' && typeof font.font.renderToImg === 'function' && typeof font.getTextWidth === 'function' && typeof font.getHeight === 'function', 'Native card font is unavailable.');
    return font;
  }

  function validateName(text) {
    assert(typeof text === 'string', 'A preset name must be text.');
    const font = nativeFont();
    // Native BitmapFont walks UTF-16 code units, so astral characters are unsupported.
    for (const letter of text) {
      assert(letter.length === 1 && font.font.containsCharacter(letter), `The game font cannot display ${JSON.stringify(letter)}. Choose another character.`);
    }
    return true;
  }

  function renderName(canvas, text, settings = {}) {
    let bitmap;
    if (canvas?.dataset) canvas.dataset.idleonCardPresetsFont = 'true';
    try {
      validateName(text);
      if (!text.length) return false;
      const font = nativeFont();
      const BitmapData = gameRoot['openfl.display.BitmapData'];
      const assetScale = Number(gameRoot['com.stencyl.Engine']?.SCALE);
      const scale = Number(settings.scale ?? 1);
      const maxWidth = Number(settings.maxWidth ?? 253 * scale);
      assert(typeof BitmapData === 'function' && [assetScale, scale, maxWidth].every(value => Number.isFinite(value) && value > 0), 'Native font rendering is unavailable.');
      const cssWidth = value => font.getTextWidth(value) / assetScale * scale;
      let rendered = text;
      if (cssWidth(rendered) > maxWidth) {
        assert(font.font.containsCharacter('.') && cssWidth('...') <= maxWidth, 'Name area is too narrow.');
        while (rendered.length && cssWidth(`${rendered}...`) > maxWidth) rendered = rendered.slice(0, -1);
        rendered += '...';
      }
      const width = Math.ceil(font.getTextWidth(rendered));
      const height = Math.ceil(font.getHeight());
      assert(width > 0 && height > 0 && width <= 8192 && height <= 1024, 'Invalid native font dimensions.');
      bitmap = new BitmapData(width, height, true, 0);
      // Match native drawString: preserve original atlas color instead of tinting.
      font.font.renderToImg(bitmap, rendered, 0, 1, 0, 0, font.fontScale, 0, false);
      const source = bitmap.image?.get_src?.();
      const context = canvas?.getContext?.('2d');
      assert(source && context && canvas.style, 'Name canvas is unavailable.');
      const cssW = width / assetScale * scale, cssH = height / assetScale * scale;
      const dpr = Number(canvas.ownerDocument?.defaultView?.devicePixelRatio || globalThis.devicePixelRatio || 1);
      assert(Number.isFinite(dpr) && dpr > 0 && dpr <= 8, 'Unsupported display pixel density.');
      canvas.width = Math.max(1, Math.ceil(cssW * dpr));
      canvas.height = Math.max(1, Math.ceil(cssH * dpr));
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.style.imageRendering = 'pixelated';
      if (canvas.dataset) canvas.dataset.idleonCardPresetsFont = 'true';
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      return true;
    } catch {
      // The caller must retain its complete text fallback if font/glyphs are unavailable.
      return false;
    } finally {
      if (bitmap && typeof bitmap.dispose === 'function') bitmap.dispose();
    }
  }

  function cardLabel(id) {
    if (id === 'B') return 'Empty';
    if (typeof id !== 'string') return '';
    try {
      const { get } = resolve();
      const name = get('MonsterDefinitionsGET')?.h?.[id]?.h?.Name;
      return typeof name === 'string' && name.trim() ? name.replace(/_/g, ' ') : id;
    } catch { return id; }
  }

  return { getState, getAnchor, validate, apply, validateName, renderName, cardLabel, destroy() { destroyed = true; } };
}
