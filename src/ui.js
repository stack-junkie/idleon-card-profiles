/** Self-contained: this factory is serialized into the game page by the helper. */
export function mountOverlay(controller, options = {}) {
  const doc = document;
  const win = window;
  const previousInputHandler = win.__idleonCardProfilesHandleInput;
  const previousInputActive = win.__idleonCardProfilesInputActive;
  const root = doc.createElement('div');
  root.id = 'idleon-card-profiles';
  root.className = 'icp-root';
  root.setAttribute('aria-label', 'Card preset profiles');
  const style = doc.createElement('style');
  style.textContent = `${options.fontFaceCss || ''}
    #idleon-card-profiles { --icp-scale:1; position:fixed; inset:0; z-index:2147483000; pointer-events:none; color:#f5e4a9; font:700 16px ${options.fontFamily || '"Lucida Console", Consolas, monospace'}; text-shadow:1px 1px #191919,-1px -1px #191919,1px -1px #191919,-1px 1px #191919; }
    #idleon-card-profiles *, #idleon-card-profiles *:before { box-sizing:border-box; }
    #idleon-card-profiles [hidden] { display:none!important; }
    #idleon-card-profiles button, #idleon-card-profiles input, #idleon-card-profiles select { font:inherit; color:inherit; text-shadow:inherit; }
    #idleon-card-profiles button { cursor:pointer; border:2px solid #161616; border-radius:3px; background:linear-gradient(#717171 0%,#505050 45%,#363636 46%,#414141 100%); box-shadow:inset 1px 1px #bababa,inset -1px -1px #858585,0 0 0 1px #929292; padding:6px 10px; }
    #idleon-card-profiles button:hover:not(:disabled) { color:#fff4b1; filter:brightness(1.2); }
    #idleon-card-profiles button:active:not(:disabled) { background:#353535; box-shadow:inset 1px 1px #171717,0 0 0 1px #aaa; }
    #idleon-card-profiles button:disabled { opacity:.45; cursor:default; }
    #idleon-card-profiles :focus-visible { outline:2px solid #f4db72; outline-offset:3px; }
    #idleon-card-profiles .icp-row { position:fixed; display:flex; align-items:center; gap:calc(6px * var(--icp-scale)); pointer-events:auto; }
    #idleon-card-profiles .icp-icon { flex:0 0 auto; width:calc(27px * var(--icp-scale)); height:calc(25px * var(--icp-scale)); padding:calc(3px * var(--icp-scale)); }
    #idleon-card-profiles svg { display:block; width:100%; height:100%; shape-rendering:crispEdges; }
    #idleon-card-profiles .icp-name { flex:1; min-width:0; font-size:calc(18px * var(--icp-scale)); line-height:1.15; color:#efd995; background:none; box-shadow:none; border:1px solid transparent; padding:0 3px; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #idleon-card-profiles .icp-name:hover { border-color:#888; background:#4445; }
    #idleon-card-profiles .icp-name canvas { display:block; margin:0 auto; image-rendering:pixelated; pointer-events:none; max-width:100%; }
    #idleon-card-profiles .icp-edit { flex:1; min-width:0; width:0; text-align:center; font-size:calc(18px * var(--icp-scale)); border:1px solid #d8c774; background:#252525; outline:none; padding:2px 3px; }
    #idleon-card-profiles .icp-shade { position:fixed; inset:0; background:#0007; pointer-events:auto; }
    #idleon-card-profiles .icp-dialog { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); width:min(620px,calc(100vw - 24px)); max-height:calc(100vh - 32px); display:flex; flex-direction:column; gap:14px; overflow:auto; pointer-events:auto; background:#444; border:3px solid #181818; border-radius:7px; box-shadow:inset 0 0 0 2px #b3b3b3,inset 0 0 0 5px #747474,0 0 0 2px #9e9e9e,3px 4px 0 #202020; padding:20px; font-size:15px; }
    #idleon-card-profiles .icp-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; color:#fff; }
    #idleon-card-profiles h2 { margin:0; font-size:21px; }
    #idleon-card-profiles p { margin:0; line-height:1.5; }
    #idleon-card-profiles .icp-close { font-size:18px; padding:2px 8px; }
    #idleon-card-profiles .icp-field { display:flex; flex-direction:column; gap:7px; }
    #idleon-card-profiles input:not([type=file]), #idleon-card-profiles select { min-width:0; width:100%; padding:8px; background:#282828; border:2px solid #191919; box-shadow:0 0 0 1px #989898; border-radius:2px; }
    #idleon-card-profiles .icp-profiles { display:flex; flex-direction:column; gap:7px; max-height:min(440px,55vh); overflow:auto; padding:3px; }
    #idleon-card-profiles .icp-group-heading { display:flex; gap:4px; }
    #idleon-card-profiles .icp-profile { text-align:left; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #idleon-card-profiles .icp-expand { flex:0 0 34px; padding:4px; }
    #idleon-card-profiles .icp-delete { flex:0 0 30px; padding:6px; color:#c8c8c8; }
    #idleon-card-profiles .icp-delete:hover:not(:disabled) { color:#ffc5a8; }
    #idleon-card-profiles .icp-details { padding:10px; background:#353535; border:1px solid #777; border-top:0; }
    #idleon-card-profiles .icp-details .icp-preview { max-height:none; border:0; box-shadow:none; padding:8px 0 0; }
    #idleon-card-profiles .icp-heading-tools { display:flex; align-items:center; gap:12px; }
    #idleon-card-profiles .icp-help { border-radius:50%; width:25px; height:25px; padding:0; font-size:17px; }
    #idleon-card-profiles .icp-load-actions { display:flex; gap:12px; }
    #idleon-card-profiles .icp-load-actions .icp-primary { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #idleon-card-profiles .icp-profile[aria-pressed=true] { border-color:#ecd46f; box-shadow:inset 0 0 0 1px #2b2615; }
    #idleon-card-profiles .icp-meta { font-size:12px; color:#ccc; line-height:1.5; }
    #idleon-card-profiles .icp-preview { border:2px solid #252525; box-shadow:0 0 0 1px #777; background:#353535; max-height:220px; overflow:auto; padding:9px; }
    #idleon-card-profiles .icp-slot + .icp-slot { border-top:1px solid #626262; margin-top:8px; padding-top:8px; }
    #idleon-card-profiles .icp-cards { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:4px; margin-top:5px; }
    #idleon-card-profiles .icp-card { padding:3px 5px; background:#222; border:1px solid #797979; color:#ddd; font:12px monospace; text-shadow:none; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #idleon-card-profiles .icp-actions { display:flex; flex-wrap:wrap; gap:9px; }
    #idleon-card-profiles .icp-primary { color:#fff0ab; }
    #idleon-card-profiles .icp-muted { color:#c3c3c3; font-size:13px; }
    #idleon-card-profiles .icp-status { position:fixed; max-width:min(560px,90vw); left:50%; bottom:22px; transform:translateX(-50%); padding:9px 13px; border:2px solid #aaa; background:#2d2d2d; box-shadow:0 0 0 2px #161616; pointer-events:auto; line-height:1.45; white-space:pre-wrap; }
    #idleon-card-profiles .icp-error { color:#ffc5a8; }
    #idleon-card-profiles .icp-inline-status { line-height:1.45; white-space:pre-wrap; }
    @media(max-width:500px) { #idleon-card-profiles .icp-dialog { padding:15px; font-size:13px; gap:10px; } #idleon-card-profiles h2 { font-size:18px; } }
  `;
  root.append(style);
  const make = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const action = (label, id, className = '') => {
    const node = make('button', className, label);
    node.type = 'button';
    node.dataset.action = id;
    return node;
  };
  const icon = (kind) => {
    const button = action('', kind, 'icp-icon');
    const label = kind === 'load' ? 'Load card profile' : 'Save card profile';
    button.title = label;
    button.setAttribute('aria-label', label);
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    const path = doc.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('fill', '#ead89a');
    path.setAttribute('stroke', '#171717');
    path.setAttribute('stroke-width', '1');
    path.setAttribute('d', kind === 'save'
      ? 'M2 2h14l2 2v14H2z M6 3v5h8V3z M5 11v6h10v-6z M11 4h2v3h-2z'
      : 'M1 5h7l2 2h8v3H4L1 17z M5 10h14l-3 7H1z M10 1h3v4h3l-4 4-4-4h2z');
    path.setAttribute('fill-rule', 'evenodd');
    svg.append(path); button.append(svg);
    return button;
  };
  const row = make('div', 'icp-row');
  const loadButton = icon('load');
  const nameButton = action('', 'name', 'icp-name');
  const nameCanvas = make('canvas');
  nameCanvas.setAttribute('aria-hidden', 'true');
  nameButton.title = 'Double-click to rename';
  nameButton.setAttribute('aria-label', 'Preset name. Double-click or press Enter to rename.');
  const edit = make('input', 'icp-edit');
  edit.type = 'text'; edit.autocomplete = 'off'; edit.spellcheck = false;
  edit.setAttribute('aria-label', 'Preset name'); edit.hidden = true;
  const saveButton = icon('save');
  row.append(loadButton, nameButton, edit, saveButton);
  const shade = make('div', 'icp-shade'); shade.hidden = true;
  const dialog = make('section', 'icp-dialog'); dialog.hidden = true;
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
  const status = make('div', 'icp-status'); status.hidden = true;
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  root.append(row, shade, dialog, status);
  doc.body.append(root);

  let view = controller.getView();
  let editing = null;
  let modal = null;
  let chosenId = null;
  const expandedIds = new Set();
  let helpOpen = false;
  let deleteId = null;
  let saveTarget = '';
  let draftTitle = '';
  let localError = '';
  let localNotice = '';
  let pending = false;
  let destroyed = false;
  let inputActive = false;
  let dialogSignature = '';
  let renderedNameSignature = '';
  let modalOrigin = null;
  let outsidePointerDown = false;
  let deferredBlur = null;
  let blurGeneration = 0;
  const blurFrames = new Set();
  const limit = (value, count = 32) => Array.from(value).slice(0, count).join('');
  const contextKey = () => JSON.stringify([view.context?.accountId, view.context?.characterId, view.selected]);
  const busy = () => pending || Boolean(view.busy);
  const displayName = () => view.names?.[view.selected] || `Preset ${Number(view.selected) + 1}`;
  const inputState = () => {
    const active = !destroyed && Boolean(editing || modal || root.contains(doc.activeElement));
    root.dataset.inputActive = String(active);
    win.__idleonCardProfilesInputActive = active;
    if (inputActive !== active) {
      inputActive = active;
      win.dispatchEvent(new CustomEvent('idleon-card-profiles-input', { detail: { active } }));
    }
  };
  const announce = (message) => { localNotice = message; localError = ''; renderStatus(); };
  function renderStatus() {
    const error = localError || view.error || '';
    const message = error || (busy() ? 'Saving changes…' : localNotice);
    status.textContent = message;
    status.classList.toggle('icp-error', Boolean(error));
    status.hidden = !message || Boolean(modal) || !view.visible;
    const inline = dialog.querySelector('.icp-inline-status');
    if (inline) { inline.textContent = message; inline.classList.toggle('icp-error', Boolean(error)); inline.hidden = !message; }
  }
  async function run(callback, success) {
    if (busy() || destroyed) return;
    pending = true; localError = ''; localNotice = ''; render();
    try { const result = await callback(); if (destroyed) return; if (success) success(result); }
    catch (error) { if (!destroyed) localError = error?.message || String(error); }
    finally { pending = false; if (!destroyed) { view = controller.getView(); render(); } }
  }
  function cancelEdit() {
    deferredBlur = null; outsidePointerDown = false; blurGeneration++;
    editing = null; edit.hidden = true; nameButton.hidden = false; inputState();
  }
  function beginEdit() {
    if (busy() || !view.ready || !view.visible || modal) return;
    editing = { key: contextKey(), context: { ...view.context }, slot: view.selected };
    edit.value = view.names?.[view.selected] || '';
    edit.placeholder = `Preset ${Number(view.selected) + 1}`;
    edit.hidden = false; nameButton.hidden = true; inputState(); edit.focus(); edit.select();
  }
  function commitEdit() {
    if (!editing) return;
    const original = editing;
    const name = limit(edit.value.trim());
    const valid = view.visible && view.ready && original.key === contextKey();
    cancelEdit();
    if (valid) run(() => controller.rename(name, original.context, original.slot));
  }
  edit.addEventListener('input', () => { if (Array.from(edit.value).length > 32) edit.value = limit(edit.value); });
  edit.addEventListener('blur', () => {
    // A native button changes game state after mousedown has already blurred us.
    // Wait for that gesture and the game frame before deciding whether to save.
    if (outsidePointerDown && editing) deferredBlur = editing;
    else commitEdit();
  });
  function settleOutsideBlur() {
    if (!deferredBlur || deferredBlur !== editing) return;
    const original = deferredBlur;
    const generation = ++blurGeneration;
    const frame = callback => {
      const handle = win.requestAnimationFrame(() => { blurFrames.delete(handle); callback(); });
      blurFrames.add(handle);
    };
    frame(() => frame(async () => {
      if (destroyed || generation !== blurGeneration || editing !== original) return;
      try {
        await controller.refresh?.();
        if (destroyed || generation !== blurGeneration || editing !== original) return;
        view = controller.getView();
        // render cancels when character, preset, readiness, or menu has changed.
        render();
        if (editing === original && deferredBlur === original) commitEdit();
      } catch (error) {
        if (destroyed || generation !== blurGeneration || editing !== original) return;
        cancelEdit(); localError = error?.message || 'Could not verify the selected preset. The edit was cancelled.'; renderStatus();
      }
    }));
  }
  function closeModal() {
    modal = null; dialogSignature = ''; shade.hidden = true; dialog.hidden = true; inputState();
    if (view.visible && view.ready) (modalOrigin === 'save' ? saveButton : loadButton).focus();
    renderStatus();
  }
  function openModal(kind) {
    if (busy() || !view.ready || !view.visible) return;
    if (editing) commitEdit();
    modal = kind; modalOrigin = kind; localError = ''; localNotice = ''; saveTarget = ''; draftTitle = '';
    chosenId = null; expandedIds.clear(); helpOpen = false; deleteId = null;
    dialogSignature = ''; inputState(); renderDialog(); renderStatus();
    (dialog.querySelector('input:not([type=file])') || dialog.querySelector('button'))?.focus();
  }
  function addField(label, control) {
    control.setAttribute('aria-label', label);
    const field = make('label', 'icp-field'); field.append(make('span', '', label), control); dialog.append(field);
  }
  function renderPreview(profile) {
    const preview = make('div', 'icp-preview');
    preview.setAttribute('aria-label', 'Profile preset preview');
    for (const [index, preset] of (profile.presets || []).entries()) {
      const item = make('div', 'icp-slot');
      item.append(make('div', '', `${index + 1}. ${preset.name || `Preset ${index + 1}`}`));
      const cards = make('div', 'icp-cards');
      for (const [position, card] of (preset.cards || []).entries()) {
        const label = card && card !== 'Blank' && card !== 'B' ? (controller.cardLabel?.(card) || card) : 'Empty';
        const cell = make('span', 'icp-card', `${position + 1}: ${label}`);
        cell.title = `${position + 1}: ${label}`;
        cards.append(cell);
      }
      item.append(cards); preview.append(item);
    }
    return preview;
  }
  function renderDialog() {
    if (!modal) return;
    shade.hidden = false; dialog.hidden = false;
    const signature = JSON.stringify([modal, chosenId, [...expandedIds], helpOpen, deleteId, saveTarget, view.profiles, view.canRestore, view.context, busy()]);
    if (signature === dialogSignature) { renderStatus(); return; }
    dialogSignature = signature;
    const active = doc.activeElement;
    const focusKey = dialog.contains(active) ? active.dataset.focus : null;
    const selection = active?.tagName === 'INPUT' ? [active.selectionStart, active.selectionEnd] : null;
    dialog.replaceChildren();
    const heading = make('div', 'icp-heading');
    const title = make('h2', '', deleteId ? 'DELETE GROUP?' : helpOpen ? 'ABOUT CARD GROUPS' : modal === 'save' ? 'SAVE CARD GROUP' : 'LOAD CARD GROUP');
    title.id = 'icp-dialog-title'; dialog.setAttribute('aria-labelledby', title.id);
    const close = action('×', 'close', 'icp-close'); close.title = 'Close'; close.setAttribute('aria-label', 'Close');
    const helpText = 'A group saves all card preset names and cards. Loading replaces them for the current character; the card-set bonus stays unchanged. Groups are shared across characters. Restore returns to this character’s previous setup, kept on this computer across restarts until the next load or restore.';
    const headingTools = make('div', 'icp-heading-tools');
    if (!helpOpen && !deleteId) {
      const help = action('?', 'help', 'icp-help'); help.setAttribute('aria-label', 'About card groups'); help.title = helpText; help.dataset.focus = 'help';
      headingTools.append(help);
    }
    headingTools.append(close); heading.append(title, headingTools); dialog.append(heading);
    if (deleteId) {
      const profile = view.profiles?.find(profile => profile.id === deleteId);
      dialog.append(make('p', '', profile ? `Delete “${profile.title}”?` : 'This group no longer exists.'));
      dialog.append(make('p', 'icp-muted', 'Your characters’ cards, names, and Restore backups stay unchanged.'));
      const buttons = make('div', 'icp-actions');
      const cancel = action('Cancel', 'delete-cancel');
      const confirm = action('Delete', 'delete-confirm'); confirm.disabled = !profile || busy(); cancel.disabled = busy();
      buttons.append(cancel, confirm); dialog.append(buttons);
      const inline = make('div', 'icp-inline-status'); inline.setAttribute('role', 'status'); dialog.append(inline);
      if (!busy()) cancel.focus(); renderStatus(); return;
    }
    if (helpOpen) {
      dialog.append(make('p', '', 'A group contains every card preset’s name and cards. Groups are shared across characters.'));
      dialog.append(make('p', '', 'Loading replaces the current character’s names and cards. The selected preset and card-set bonus stay unchanged. Updating a saved group does not change copies already loaded on characters.'));
      dialog.append(make('p', '', 'Restore undoes the last load for this character. One previous setup is kept on this computer across restarts, until the next load or restore replaces it. It does nothing unless clicked.'));
      const back = action('Back', 'help-back'); dialog.append(back); back.focus(); return;
    }
    const profiles = view.profiles || [];
    if (modal === 'save') {
      const target = make('select'); target.dataset.focus = 'save-target';
      const fresh = make('option', '', 'Create a new group'); fresh.value = ''; target.append(fresh);
      for (const profile of profiles) { const option = make('option', '', `Update: ${profile.title}`); option.value = profile.id; target.append(option); }
      target.value = saveTarget;
      target.addEventListener('change', () => { saveTarget = target.value; draftTitle = profiles.find(p => p.id === saveTarget)?.title || ''; renderDialog(); });
      addField('Save as', target);
      const titleInput = make('input'); titleInput.type = 'text'; titleInput.value = draftTitle; titleInput.placeholder = 'Group name'; titleInput.dataset.focus = 'profile-title';
      titleInput.addEventListener('input', () => { draftTitle = limit(titleInput.value, 64); titleInput.value = draftTitle; const button = dialog.querySelector('[data-action="save-confirm"]'); if (button) button.disabled = busy() || !draftTitle.trim(); });
      addField('Group name', titleInput);
      const buttons = make('div', 'icp-actions');
      const confirm = action(saveTarget ? 'Update group' : 'Save group', 'save-confirm', 'icp-primary'); confirm.disabled = !draftTitle.trim();
      buttons.append(confirm, action('Cancel', 'close')); dialog.append(buttons);
    } else {
      if (!profiles.length) dialog.append(make('p', '', 'No saved groups yet.'));
      else {
        const list = make('div', 'icp-profiles'); list.setAttribute('aria-label', 'Saved groups');
        for (const profile of profiles) {
          const group = make('div', 'icp-group');
          const groupHeading = make('div', 'icp-group-heading');
          const button = action(profile.title, 'choose', 'icp-profile'); button.title = profile.title; button.dataset.profileId = profile.id; button.dataset.focus = `profile-${profile.id}`;
          button.setAttribute('aria-pressed', String(profile.id === chosenId));
          const expanded = expandedIds.has(profile.id);
          const expand = action(expanded ? '▾' : '▸', 'expand', 'icp-expand'); expand.dataset.profileId = profile.id; expand.dataset.focus = `expand-${profile.id}`;
          expand.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} ${profile.title}`); expand.setAttribute('aria-expanded', String(expanded));
          const remove = action('', 'delete', 'icp-delete'); remove.dataset.profileId = profile.id; remove.dataset.focus = `delete-${profile.id}`;
          remove.title = `Delete ${profile.title}`; remove.setAttribute('aria-label', remove.title);
          const trash = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); trash.setAttribute('viewBox', '0 0 16 16'); trash.setAttribute('aria-hidden', 'true');
          const trashPath = doc.createElementNS(trash.namespaceURI, 'path'); trashPath.setAttribute('fill', 'currentColor'); trashPath.setAttribute('d', 'M5 1h6v2h3v2H2V3h3zm-2 5h10l-1 9H4zm3 1v6h1V7zm3 0v6h1V7z'); trash.append(trashPath); remove.append(trash);
          groupHeading.append(button, remove, expand); group.append(groupHeading);
          if (expanded) {
            const details = make('div', 'icp-details'); const date = new Date(profile.savedAt);
            details.append(make('div', 'icp-meta', `${profile.sourceCharacterName || 'Unknown character'} · ${Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString()}`), renderPreview(profile));
            group.append(details);
          }
          list.append(group);
        }
        dialog.append(list);
      }
      const tools = make('div', 'icp-load-actions');
      const restore = action('Restore', 'restore'); restore.disabled = !view.canRestore;
      restore.title = 'Restore this character’s setup from before the last load. The backup survives restarts until the next load or restore.';
      const selectedProfile = profiles.find(profile => profile.id === chosenId);
      const apply = action(selectedProfile ? `Load ${selectedProfile.title}` : 'Load', 'apply', 'icp-primary'); apply.disabled = !selectedProfile; apply.title = apply.textContent;
      tools.append(restore, apply); dialog.append(tools);
    }
    const inline = make('div', 'icp-inline-status'); inline.setAttribute('role', 'status'); inline.setAttribute('aria-live', 'polite'); dialog.append(inline);
    if (busy()) for (const node of dialog.querySelectorAll('button,input,select')) node.disabled = true;
    if (focusKey) {
      const next = [...dialog.querySelectorAll('[data-focus]')].find(node => node.dataset.focus === focusKey);
      next?.focus(); if (selection && next?.tagName === 'INPUT') next.setSelectionRange(...selection);
    }
    renderStatus();
  }
  function render() {
    if (destroyed) return;
    const show = Boolean(view.ready && view.visible && view.anchor);
    if (editing && (!show || editing.key !== contextKey())) cancelEdit();
    if (modal && (!show || (modalContext && modalContext !== JSON.stringify([view.context?.accountId, view.context?.characterId])))) closeModal();
    row.hidden = !show;
    if (!show && root.contains(doc.activeElement)) { doc.activeElement.blur?.(); inputState(); }
    if (show) {
      const anchor = view.anchor;
      root.style.setProperty('--icp-scale', String(anchor.scale || 1));
      Object.assign(row.style, { left: `${anchor.left}px`, top: `${anchor.top}px`, width: `${anchor.width}px`, height: `${anchor.height}px` });
      const currentName = displayName();
      nameButton.title = `${currentName}\nDouble-click to rename`;
      nameButton.setAttribute('aria-label', `${currentName}. Double-click or press Enter to rename.`);
      const nameWidth = Math.max(0, nameButton.clientWidth - 6);
      const nameSignature = JSON.stringify([currentName, anchor.scale || 1, nameWidth, typeof controller.renderName]);
      if (!editing && (nameSignature !== renderedNameSignature || !renderedNameSignature)) {
        let drawn = false;
        if (typeof controller.renderName === 'function' && nameWidth > 0) {
          try {
            drawn = controller.renderName(nameCanvas, currentName, { scale: anchor.scale || 1, maxWidth: nameWidth }) !== false;
          } catch { drawn = false; }
        }
        if (drawn) {
          // The native font includes empty space below its letters. Center the
          // visible ink inside the existing bar instead of centering that padding.
          nameCanvas.style.transform = '';
          try {
            const pixels = nameCanvas.getContext('2d').getImageData(0, 0, nameCanvas.width, nameCanvas.height).data;
            let top = nameCanvas.height, bottom = -1;
            for (let y = 0; y < nameCanvas.height; y++) {
              for (let x = 0; x < nameCanvas.width; x++) {
                if (pixels[(y * nameCanvas.width + x) * 4 + 3]) { top = Math.min(top, y); bottom = y; break; }
              }
            }
            if (bottom >= top) {
              const cssHeight = parseFloat(nameCanvas.style.height);
              const offset = (nameCanvas.height - 1 - top - bottom) * cssHeight / nameCanvas.height / 2;
              if (Number.isFinite(offset)) nameCanvas.style.transform = `translateY(${offset}px)`;
            }
          } catch { /* Preserve the readable label if pixel inspection is unavailable. */ }
          if (nameCanvas.parentElement !== nameButton) nameButton.replaceChildren(nameCanvas);
          renderedNameSignature = nameSignature;
        } else {
          if (nameButton.textContent !== currentName || nameCanvas.parentElement === nameButton) nameButton.textContent = currentName;
          // A renderer can become available after native font textures finish loading.
          renderedNameSignature = typeof controller.renderName === 'function' ? '' : nameSignature;
        }
      }
      for (const node of [loadButton, saveButton, nameButton, edit]) node.disabled = busy();
    }
    renderDialog(); renderStatus();
  }
  let modalContext = null;
  function download(text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = doc.createElement('a'); link.href = url; link.download = `idleon-card-profiles-${new Date().toISOString().slice(0, 10)}.json`;
    root.append(link); link.click(); link.remove(); win.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function chooseImport() {
    const file = make('input'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true; root.append(file);
    file.addEventListener('change', async () => {
      const selectedFile = file.files?.[0]; file.remove();
      if (!selectedFile) return;
      if (selectedFile.size > 16 * 1024 * 1024) { localError = 'Library file is too large (maximum 16 MB).'; renderStatus(); return; }
      run(async () => controller.importLibrary(await selectedFile.text()), () => announce('Library imported.'));
    }, { once: true });
    file.addEventListener('cancel', () => file.remove(), { once: true });
    file.click();
  }
  function onAction(id, element) {
    if (id === 'name') return;
    if (busy()) return;
    if (id === 'load' || id === 'save') { modalContext = JSON.stringify([view.context?.accountId, view.context?.characterId]); openModal(id); }
    else if (id === 'close') closeModal();
    else if (id === 'delete') { deleteId = element.dataset.profileId; renderDialog(); }
    else if (id === 'delete-cancel') { deleteId = null; renderDialog(); dialog.querySelector('[data-action=help]')?.focus(); }
    else if (id === 'delete-confirm' && deleteId) { const id = deleteId; run(() => controller.deleteProfile(id), () => { if (chosenId === id) chosenId = null; expandedIds.delete(id); deleteId = null; announce('Group deleted.'); }); }
    else if (id === 'help' || id === 'help-back') { helpOpen = id === 'help'; renderDialog(); if (!helpOpen) dialog.querySelector('[data-action=help]')?.focus(); }
    else if (id === 'expand') { const id = element.dataset.profileId; if (expandedIds.has(id)) expandedIds.delete(id); else expandedIds.add(id); renderDialog(); }
    else if (id === 'choose') { chosenId = chosenId === element.dataset.profileId ? null : element.dataset.profileId; renderDialog(); }
    else if (id === 'save-confirm' && draftTitle.trim()) run(() => controller.saveProfile(draftTitle.trim(), saveTarget || null), () => { closeModal(); announce('Group saved.'); });
    else if (id === 'apply' && chosenId) run(() => controller.loadProfile(chosenId), () => { closeModal(); announce('Group loaded.'); });
    else if (id === 'restore') run(() => controller.restore(), () => { closeModal(); announce('Previous setup restored.'); });
    else if (id === 'export') run(() => controller.exportLibrary(), download);
    else if (id === 'import') chooseImport();
  }
  const listeners = [];
  const listen = (name, callback) => { win.addEventListener(name, callback, { capture: true, passive: false }); listeners.push([name, callback]); };
  function capturePointer(event) {
    const owned = root.contains(event.target);
    if (!modal && editing) {
      if (!owned && ['pointerdown', 'mousedown', 'touchstart'].includes(event.type)) {
        outsidePointerDown = true;
        blurGeneration++;
      } else if ((outsidePointerDown || deferredBlur) && ['pointerup', 'mouseup', 'click', 'touchend', 'pointercancel'].includes(event.type)) {
        outsidePointerDown = false;
        settleOutsideBlur();
      }
    }
    if (!owned && !modal) return;
    // Preserve default input focus, selection, file pickers and scroll, while stopping canvas listeners.
    event.stopImmediatePropagation();
    if (!owned) { event.preventDefault(); return; }
    if (event.type === 'dblclick') {
      if (event.target.closest?.('[data-action="name"]')) { event.preventDefault(); beginEdit(); }
      return;
    }
    if (event.type === 'click') {
      const button = event.target.closest?.('button[data-action]');
      if (button && !button.disabled) { event.preventDefault(); onAction(button.dataset.action, button); }
    }
  }
  for (const type of ['pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'wheel', 'contextmenu', 'touchstart', 'touchend', 'touchmove']) listen(type, capturePointer);
  function captureKeyboard(event) {
    if (event.__idleonCardProfilesPassThrough) return;
    if (event.__idleonCardProfilesHandled) return;
    const owned = root.contains(event.target);
    if (!owned && !modal && !editing) return;
    event.__idleonCardProfilesHandled = true;
    event.stopImmediatePropagation();
    if (event.type !== 'keydown') return;
    if (event.key === 'Escape') { event.preventDefault(); if (editing) { cancelEdit(); nameButton.focus(); } else if (deleteId && !busy()) { deleteId = null; renderDialog(); dialog.querySelector('[data-action=help]')?.focus(); } else if (helpOpen) { helpOpen = false; renderDialog(); dialog.querySelector('[data-action=help]')?.focus(); } else if (modal && !busy()) closeModal(); return; }
    if (editing && event.key === 'Enter' && !event.isComposing) { event.preventDefault(); commitEdit(); nameButton.focus(); return; }
    if (!editing && event.target === nameButton && (event.key === 'Enter' || event.key === 'F2')) { event.preventDefault(); beginEdit(); return; }
    if (modal && event.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')];
      const index = focusable.indexOf(doc.activeElement);
      if (!focusable.length) { event.preventDefault(); return; }
      if (event.shiftKey && index <= 0) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
      else if (!event.shiftKey && (index < 0 || index === focusable.length - 1)) { event.preventDefault(); focusable[0].focus(); }
    }
    if (modal && !owned) event.preventDefault();
  }
  win.__idleonCardProfilesHandleInput = captureKeyboard;
  for (const type of ['keydown', 'keyup', 'keypress']) listen(type, captureKeyboard);
  listen('focusin', () => inputState());
  listen('focusout', () => win.queueMicrotask(() => { if (!destroyed) inputState(); }));
  const unsubscribe = controller.subscribe(next => { view = next || controller.getView(); render(); });
  render();
  return {
    element: root,
    destroy() {
      for (const handle of blurFrames) win.cancelAnimationFrame(handle);
      blurFrames.clear(); deferredBlur = null; blurGeneration++;
      destroyed = true; editing = null; modal = null; inputState();
      if (previousInputHandler === undefined) delete win.__idleonCardProfilesHandleInput;
      else win.__idleonCardProfilesHandleInput = previousInputHandler;
      if (previousInputActive === undefined) delete win.__idleonCardProfilesInputActive;
      else win.__idleonCardProfilesInputActive = previousInputActive;
      if (typeof unsubscribe === 'function') unsubscribe();
      for (const [name, callback] of listeners) win.removeEventListener(name, callback, true);
      root.remove();
    },
  };
}
