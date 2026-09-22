// Copyright 2026 The Helium Authors. GPL-3.0; see LICENSE.
import {COLORS, uid, createState, restoreState, nodeById, descendants, addFolder, addSpace, deleteSpace, moveNode, removeNode, reconcile, liveTab, visibleNodes} from './model.mjs';
const $ = id => document.getElementById(id);
const native = ['chrome:', 'helium:'].includes(location.protocol);
let state = createState();
let snapshot = {windowId: 1, tabs: [], canGoBack: false, canGoForward: false};
let dragId = null, dialogAction = null, selectedColor = COLORS[0], results = [], resultIndex = 0;
const paths = {
  sidebar: ['M3 3h18v18H3z', 'M8 3v18'], back: ['m14 5-7 7 7 7', 'M7 12h14'], forward: ['m10 5 7 7-7 7', 'M3 12h14'],
  reload: ['M20 10a8 8 0 1 0 0 5', 'M20 4v6h-6'], link: ['m10 14 4-4', 'M9 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0', 'm15 8 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0'],
  settings: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z', 'M7 8h10M7 16h10M10 6v4M14 14v4'],
  more: ['M5 12h.01M12 12h.01M19 12h.01'], plus: ['M12 5v14M5 12h14'], close: ['m6 6 12 12M6 18 18 6'],
  folder: ['M2 7V5a2 2 0 0 1 2-2h5l3 3h8a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7Z', 'M2 8h20'],
  chevron: ['m9 5 7 7-7 7'], library: ['M4 4v16M9 4v16M14 5l5-1 3 15-5 1z'], search: ['M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15', 'm16 16 5 5'],
  globe: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M3 12h18M12 3c-5 5-5 13 0 18M12 3c5 5 5 13 0 18'],
};
function icon(name, className) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  for (const d of paths[name] || paths.globe) {
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path);
  }
  return svg;
}
function element(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
for (const [id, name] of Object.entries({collapse: 'sidebar', back: 'back', forward: 'forward', reload: 'reload', 'copy-url': 'link', settings: 'settings', 'space-menu': 'more', library: 'library', add: 'plus', 'command-search-icon': 'search'})) $(id).append(icon(name));
function send(action, data = {}) {
  if (native) chrome.send('arcSidebar', [action, data]);
  else window.arcPreview.send(action, data);
}
function save() { send('save', {state}); }
function announce(message) { $('live').textContent = message; }
window.arcSidebar = {
  receive(update) {
    if (update.state) state = restoreState(update.state);
    snapshot = update;
    reconcile(state, snapshot);
    render();
    save();
  },
  focusAddress() { $('address').focus(); $('address').select(); },
};
function favicon(n, tab) {
  const span = element('span', 'favicon');
  const image = tab?.favicon;
  // Only the native favicon cache supplies image data; no third-party favicon requests.
  if (image?.startsWith('data:image/png;base64,')) {
    const img = document.createElement('img'); img.src = image; img.alt = ''; span.append(img);
  } else if (!native && n.url?.includes('spotify')) {
    span.style.background = '#1ed760'; span.style.borderRadius = '50%';
    const svg = icon('more'); svg.style.strokeWidth = '3'; span.append(svg);
  } else if (!native && n.url?.includes('mail.google')) {
    span.style.background = '#fffaf5'; span.style.color = '#be3f42'; span.textContent = 'M';
  } else if (!n.url || n.url === 'chrome://newtab/') {
    span.style.background = 'transparent'; span.style.color = 'var(--muted)'; span.append(icon('globe'));
  } else {
    span.textContent = (n.name || '?').slice(0, 1).toUpperCase();
  }
  return span;
}
function activeNode() {
  const tab = snapshot.tabs.find(t => t.active);
  return tab ? nodeById(state, state.bindings[`${snapshot.windowId}:${tab.id}`]) : null;
}
function newTab(url = 'chrome://newtab/', parent = null) {
  const n = {id: uid(), type: 'tab', name: 'New Tab', url, space: state.activeSpace, parent, pinned: !!parent, favorite: false};
  state.nodes.push(n); save(); send('open', {url, nodeId: n.id});
}
function activate(n) {
  const tab = liveTab(state, snapshot, n.id);
  if (!n.favorite) state.activeSpace = n.space;
  state.lastActive[state.activeSpace] = n.id;
  save();
  if (tab) send('activate', {tabId: tab.id}); else send('open', {url: n.url || 'chrome://newtab/', nodeId: n.id});
}
function closeNode(n) {
  const tab = liveTab(state, snapshot, n.id);
  if (!n.pinned) removeNode(state, n.id);
  save(); if (tab) send('close', {tabId: tab.id}); render();
}
function switchSpace(id) {
  if (!state.spaces.some(s => s.id === id)) return;
  state.activeSpace = id;
  const previous = nodeById(state, state.lastActive[id]);
  const next = previous?.space === id && !previous.favorite ? previous : state.nodes.find(n => n.space === id && n.type === 'tab' && !n.favorite && liveTab(state, snapshot, n.id));
  render(); save();
  if (next) activate(next); else newTab();
  announce(`${state.spaces.find(s => s.id === id).name} space`);
}
function dragSource(el, n) {
  el.draggable = true;
  el.addEventListener('dragstart', event => {
    dragId = n.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-helium-node', n.id);
  });
  el.addEventListener('dragend', clearDrop);
}
function clearDrop() { dragId = null; document.querySelectorAll('.drop-target,.drop-before').forEach(e => e.classList.remove('drop-target', 'drop-before')); }
function dropTarget(el, destination, before = null, edge = null) {
  const atEdge = e => edge && e.clientY < el.getBoundingClientRect().top + 9;
  el.addEventListener('dragover', e => {
    if (!dragId) return;
    e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move';
    el.classList.remove('drop-before', 'drop-target');
    el.classList.add(before || atEdge(e) ? 'drop-before' : 'drop-target');
  });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop-target', 'drop-before'); });
  el.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation();
    if (dragId && moveNode(state, dragId, atEdge(e) ? edge : {...destination, before})) { save(); render(); announce('Moved'); }
    clearDrop();
  });
}
function row(n, level = 1) {
  const tab = liveTab(state, snapshot, n.id);
  const isFolder = n.type === 'folder';
  const el = element('div', `row ${isFolder ? 'folder' : ''} ${tab?.active ? 'active' : ''} ${tab?.loading ? 'loading' : ''}`);
  el.tabIndex = 0; el.dataset.nodeId = n.id; el.setAttribute('role', 'treeitem'); el.setAttribute('aria-level', level);
  el.setAttribute('aria-label', n.name); el.setAttribute('aria-selected', String(!!tab?.active));
  if (isFolder) {
    el.setAttribute('aria-expanded', String(!n.collapsed));
    const disclosure = element('span', 'disclosure'); disclosure.append(icon('chevron')); el.append(disclosure, icon('folder', 'folder-icon'));
  } else el.append(favicon(n, tab));
  el.append(element('span', 'label', n.name));
  el.title = isFolder ? n.name : `${n.name}\n${tab?.url || n.url}`;
  const action = () => {
    if (isFolder) { n.collapsed = !n.collapsed; save(); render(); document.querySelector(`[data-node-id="${CSS.escape(n.id)}"]`)?.focus(); }
    else activate(n);
  };
  el.addEventListener('click', action);
  el.addEventListener('dblclick', () => { if (isFolder) edit('Rename Folder', n.name, name => { n.name = name; }); });
  el.addEventListener('keydown', e => {
    if (e.target !== el) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); action(); }
    if (isFolder && ['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); n.collapsed = e.key === 'ArrowLeft'; save(); render(); document.querySelector(`[data-node-id="${CSS.escape(n.id)}"]`)?.focus(); }
    if (e.key === 'F2') { e.preventDefault(); edit('Rename', n.name, name => { n.name = name; }); }
    if (e.shiftKey && e.key === 'F10') { e.preventDefault(); nodeMenu(n, el.getBoundingClientRect()); }
  });
  if (!isFolder) {
    const close = element('button', 'close-tab'); close.setAttribute('aria-label', `Close ${n.name}`); close.title = n.pinned ? 'Close tab; keep pin' : 'Close tab'; close.append(icon('close'));
    close.addEventListener('click', e => { e.stopPropagation(); closeNode(n); }); el.append(close);
    el.addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); closeNode(n); } });
  }
  el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); nodeMenu(n, {x: e.clientX, y: e.clientY}); });
  dragSource(el, n);
  dropTarget(el, {space: n.space, parent: isFolder ? n.id : n.parent, pinned: n.pinned}, isFolder ? null : n.id, isFolder ? {space: n.space, parent: n.parent, pinned: true, before: n.id} : null);
  return el;
}
function renderTree(container, parent = null, level = 1) {
  for (const n of visibleNodes(state, parent)) {
    container.append(row(n, level));
    if (n.type === 'folder' && !n.collapsed) {
      const children = element('div', 'children'); children.setAttribute('role', 'group'); renderTree(children, n.id, level + 1); container.append(children);
    }
  }
}
function render() {
  const focused = document.activeElement?.dataset?.nodeId;
  const space = state.spaces.find(s => s.id === state.activeSpace);
  document.documentElement.style.setProperty('--space', space.color);
  $('space-title').textContent = space.name;
  $('back').disabled = !snapshot.canGoBack; $('forward').disabled = !snapshot.canGoForward;
  const tab = snapshot.tabs.find(t => t.active);
  if (document.activeElement !== $('address')) {
    $('address').value = tab?.url && tab.url !== 'chrome://newtab/' ? tab.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : '';
    $('address').title = tab?.url || 'Search or enter URL';
  }
  for (const id of ['favorites', 'pinned', 'tabs', 'spaces']) $(id).replaceChildren();
  for (const n of state.nodes.filter(n => n.favorite)) {
    const tab = liveTab(state, snapshot, n.id);
    const button = element('button', `favorite ${tab?.active ? 'active' : ''}`); button.title = n.name; button.setAttribute('aria-label', n.name); button.setAttribute('aria-pressed', String(!!tab?.active)); button.append(favicon(n, tab));
    button.addEventListener('click', () => activate(n));
    button.addEventListener('contextmenu', e => { e.preventDefault(); nodeMenu(n, {x: e.clientX, y: e.clientY}); });
    dragSource(button, n); dropTarget(button, {space: n.space, favorite: true}, n.id); $('favorites').append(button);
  }
  renderTree($('pinned'));
  for (const n of visibleNodes(state, null, false)) {
    // Dormant unpinned nodes from other windows never appear in this window.
    if (liveTab(state, snapshot, n.id)) $('tabs').append(row(n));
  }
  $('empty').hidden = $('tabs').childElementCount > 0;
  for (const s of state.spaces) {
    const button = element('button', 'space', s.icon); button.title = s.name; button.setAttribute('aria-label', `${s.name} space`); button.setAttribute('aria-current', String(s.id === state.activeSpace));
    button.addEventListener('click', () => switchSpace(s.id));
    button.addEventListener('contextmenu', e => { e.preventDefault(); spaceMenu(s, {x: e.clientX, y: e.clientY}); });
    dropTarget(button, {space: s.id, pinned: true}); $('spaces').append(button);
  }
  if (focused) document.querySelector(`[data-node-id="${CSS.escape(focused)}"]`)?.focus({preventScroll: true});
  document.dispatchEvent(new CustomEvent('arc-render', {detail: {state, snapshot}}));
}
function menu(items, position) {
  const target = $('context-menu'); target.replaceChildren();
  for (const item of items) {
    if (!item) { target.append(document.createElement('hr')); continue; }
    const button = element('button', item.danger ? 'danger' : '', item.label); button.setAttribute('role', 'menuitem');
    button.addEventListener('click', () => { target.hidden = true; item.run(); }); target.append(button);
  }
  target.hidden = false;
  const rect = target.getBoundingClientRect();
  target.style.left = `${Math.max(8, Math.min(position.x ?? position.left, innerWidth - rect.width - 8))}px`;
  target.style.top = `${Math.max(8, Math.min(position.y ?? position.bottom, innerHeight - rect.height - 8))}px`;
  target.querySelector('button')?.focus();
}
function nodeMenu(n, position) {
  const items = [{label: 'Rename', run: () => edit('Rename', n.name, name => { n.name = name; })}];
  if (n.type === 'folder') {
    items.push({label: 'New nested folder', run: () => edit('New Folder', '', name => addFolder(state, name, n.id))}, {label: 'New tab in folder', run: () => newTab('chrome://newtab/', n.id)});
  } else {
    items.push({label: n.favorite ? 'Remove from Favorites' : 'Add to Favorites', run: () => { moveNode(state, n.id, {space: n.space, favorite: !n.favorite}); save(); render(); }});
    items.push({label: n.pinned ? 'Unpin tab' : 'Pin tab', run: () => { moveNode(state, n.id, {space: n.space, pinned: !n.pinned}); save(); render(); }});
    if (n.pinned) items.push({label: 'Reset to pinned URL', run: () => { const tab = liveTab(state, snapshot, n.id); if (tab) send('navigate', {tabId: tab.id, url: n.url}); else activate(n); }});
  }
  items.push(null);
  for (const s of state.spaces.filter(s => s.id !== n.space)) items.push({label: `Move to ${s.name}`, run: () => { moveNode(state, n.id, {space: s.id, pinned: n.pinned}); save(); render(); }});
  for (const f of state.nodes.filter(f => f.type === 'folder' && f.space === n.space && !descendants(state, n.id).has(f.id))) items.push({label: `Move into ${f.name}`, run: () => { moveNode(state, n.id, {space: n.space, parent: f.id}); save(); render(); }});
  if (n.parent) items.push({label: 'Move out of folder', run: () => { moveNode(state, n.id, {space: n.space}); save(); render(); }});
  items.push(null, {label: n.type === 'folder' ? 'Delete folder and contents' : 'Remove', danger: true, run: () => {
    const ids = descendants(state, n.id); const tabs = snapshot.tabs.filter(t => ids.has(state.bindings[`${snapshot.windowId}:${t.id}`]));
    removeNode(state, n.id); save(); for (const tab of tabs) send('close', {tabId: tab.id}); render();
  }});
  menu(items, position);
}
function edit(title, value, action, color = null) {
  dialogAction = action; $('dialog-title').textContent = title; $('edit-name').value = value;
  $('colors').hidden = !color; selectedColor = color || COLORS[0]; renderColors();
  $('edit-dialog').showModal(); $('edit-name').focus(); $('edit-name').select();
}
function renderColors() {
  $('colors').replaceChildren();
  for (const color of COLORS) {
    const button = element('button', 'swatch'); button.type = 'button'; button.style.setProperty('--swatch', color); button.setAttribute('aria-label', color); button.setAttribute('aria-pressed', String(color === selectedColor));
    button.addEventListener('click', () => { selectedColor = color; renderColors(); }); $('colors').append(button);
  }
}
function spaceMenu(s, position) {
  const items = [
    {label: 'Edit space', run: () => edit('Edit Space', s.name, (name, color) => { s.name = name; s.color = color; }, s.color)},
    {label: 'New folder', run: () => edit('New Folder', '', name => addFolder(state, name))},
    {label: 'New space', run: () => edit('New Space', '', (name, color) => { const next = addSpace(state, name, color); if (next) switchSpace(next.id); }, COLORS[state.spaces.length % COLORS.length])},
  ];
  if (state.spaces.length > 1) items.push(null, {label: 'Delete space · keep tabs', danger: true, run: () => { deleteSpace(state, s.id); save(); render(); }});
  menu(items, position);
}
$('edit-form').addEventListener('submit', e => { e.preventDefault(); const name = $('edit-name').value.trim(); if (!name) return; dialogAction?.(name, selectedColor); $('edit-dialog').close(); save(); render(); });
$('cancel').onclick = () => $('edit-dialog').close();
$('space-title').onclick = () => { const s = state.spaces.find(s => s.id === state.activeSpace); edit('Edit Space', s.name, (name, color) => { s.name = name; s.color = color; }, s.color); };
$('space-menu').onclick = () => spaceMenu(state.spaces.find(s => s.id === state.activeSpace), $('space-menu').getBoundingClientRect());
$('add').onclick = () => spaceMenu(state.spaces.find(s => s.id === state.activeSpace), $('add').getBoundingClientRect());
function commandPalette() { $('command-dialog').showModal(); $('command-input').value = ''; resultIndex = 0; renderResults(); $('command-input').focus(); }
$('new-tab').onclick = commandPalette;
$('command-input').addEventListener('input', () => { resultIndex = 0; renderResults(); });
function renderResults() {
  const query = $('command-input').value.trim().toLowerCase();
  results = state.nodes.filter(n => n.type === 'tab' && `${n.name} ${n.url}`.toLowerCase().includes(query)).slice(0, 8);
  const options = [...results, {id: 'new', name: query ? `Search or open “${$('command-input').value.trim()}”` : 'New blank tab'}];
  resultIndex = Math.max(0, Math.min(resultIndex, options.length - 1)); $('command-results').replaceChildren();
  options.forEach((n, index) => {
    const button = element('button', 'command-result'); button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(index === resultIndex));
    button.append(n.id === 'new' ? icon('plus') : favicon(n), element('span', '', n.name));
    button.onclick = () => chooseResult(index); $('command-results').append(button);
  });
}
function chooseResult(index) { $('command-dialog').close(); if (index < results.length) activate(results[index]); else newTab($('command-input').value.trim() || 'chrome://newtab/'); }
$('command-form').onsubmit = e => { e.preventDefault(); chooseResult(resultIndex); };
$('command-input').onkeydown = e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); resultIndex += e.key === 'ArrowDown' ? 1 : -1; renderResults(); } };
$('address').addEventListener('focus', () => { $('address').value = snapshot.tabs.find(t => t.active)?.url || ''; $('address').select(); });
$('address').addEventListener('blur', () => render());
$('address-form').onsubmit = e => { e.preventDefault(); const url = $('address').value.trim(); if (url) send('navigate', {url}); $('address').blur(); };
$('copy-url').onclick = () => { send('copyURL'); announce('URL copied'); };
for (const command of ['back', 'forward', 'reload', 'collapse', 'settings']) $(command).onclick = () => send(command);
$('library').onclick = () => newTab('chrome://history/');
dropTarget($('pinned'), {pinned: true}); dropTarget($('tabs'), {pinned: false}); dropTarget($('favorites'), {favorite: true});
document.addEventListener('pointerdown', e => { if (!$('context-menu').contains(e.target)) $('context-menu').hidden = true; });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') $('context-menu').hidden = true;
  if (!$('context-menu').hidden && ['ArrowDown', 'ArrowUp'].includes(e.key)) {
    e.preventDefault(); const buttons = [...$('context-menu').querySelectorAll('button')]; const i = buttons.indexOf(document.activeElement); buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus(); return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 't') { e.preventDefault(); if (!$('command-dialog').open) commandPalette(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') { e.preventDefault(); window.arcSidebar.focusAddress(); }
  if ((e.metaKey || e.ctrlKey) && e.altKey && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault(); const i = state.spaces.findIndex(s => s.id === state.activeSpace); switchSpace(state.spaces[(i + (e.key === 'ArrowRight' ? 1 : state.spaces.length - 1)) % state.spaces.length].id);
  }
  if (['ArrowDown', 'ArrowUp'].includes(e.key) && document.activeElement?.matches('.row')) {
    e.preventDefault(); const rows = [...document.querySelectorAll('.row')]; const i = rows.indexOf(document.activeElement); rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  }
});
let swipe = 0, swipeAt = 0;
$('sidebar').addEventListener('wheel', e => {
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || state.spaces.length < 2) return;
  e.preventDefault();
  const now = performance.now();
  if (now - swipeAt > 250) swipe = 0;
  if (swipeAt > now) return;
  swipe += e.deltaX; swipeAt = now;
  if (Math.abs(swipe) > 100) {
    const i = state.spaces.findIndex(s => s.id === state.activeSpace);
    switchSpace(state.spaces[(i + (swipe > 0 ? 1 : state.spaces.length - 1)) % state.spaces.length].id);
    swipe = 0; swipeAt = now + 350;
  }
}, {passive: false});
if (native) {
  if (navigator.platform.includes('Mac')) document.body.classList.add('native-mac');
  send('ready');
} else {
  document.body.classList.add('preview');
  await import('./preview.mjs');
  send('ready');
}
