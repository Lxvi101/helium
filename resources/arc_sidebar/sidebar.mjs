// Copyright 2026 The Helium Authors. GPL-3.0; see LICENSE.
import {COLORS, uid, createState, restoreState, nodeById, descendants, addFolder, addSpace, deleteSpace, moveNode, removeNode, reconcile, liveTab, visibleNodes} from './model.mjs';
const $ = id => document.getElementById(id);
const native = ['chrome:', 'helium:'].includes(location.protocol);
let state = createState();
let snapshot = {windowId: 1, tabs: [], canGoBack: false, canGoForward: false};
let dialogAction = null, selectedColor = COLORS[0], results = [], resultIndex = 0;
// Animation state. `painted` and `shownSpace` describe the DOM currently on screen.
const root = document.documentElement, reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let animations = true, motion = false, painted = false, shownSpace = null, spaceDirection = 0;
// `slide` is the running space carousel animation; `swipe` a trackpad gesture.
let slide = null, swipe = null;
// An underdamped spring with a slight overshoot, sampled for linear() easing.
const spring = (() => {
  const points = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40 * 6.4, d = Math.sqrt(1 - .72 ** 2);
    points.push((1 - Math.exp(-.72 * t) * (Math.cos(d * t) + .72 / d * Math.sin(d * t))).toFixed(4));
  }
  points[40] = '1';
  const value = `linear(${points.join(', ')})`;
  return CSS.supports('transition-timing-function', value) ? value : 'cubic-bezier(.22, 1, .36, 1)';
})();
function setMotion() {
  motion = animations && !reducedMotion.matches;
  root.classList.toggle('motion', motion);
  if (!motion) { slide?.finish(); cancelSwipe(); }
}
reducedMotion.addEventListener('change', setMotion);
setMotion();
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
    if (animations !== (update.animations !== false)) { animations = update.animations !== false; setMotion(); }
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
function switchSpace(id, direction = 0) {
  if (!state.spaces.some(s => s.id === id)) return;
  spaceDirection = direction;
  state.activeSpace = id;
  const previous = nodeById(state, state.lastActive[id]);
  const next = previous?.space === id && !previous.favorite ? previous : state.nodes.find(n => n.space === id && n.type === 'tab' && !n.favorite && liveTab(state, snapshot, n.id));
  render(); save();
  if (next) activate(next); else newTab();
  announce(`${state.spaces.find(s => s.id === id).name} space`);
}
// Drag and drop, modeled on Arc. A card follows the pointer from where it was
// grabbed: a row over the tab list, a tile over Favorites, morphing between the
// two. Folders fill edge to edge when a drop would nest inside them, a line
// marks where a drop would insert, and Favorites open a gap for the tile.
const FOLDER_EDGE = 9;
let pendingDrag = null, drag = null, suppressClick = false;
function dragSource(el, n) {
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('.close-tab')) return;
    pendingDrag = {n, rect: el.getBoundingClientRect(), x: e.clientX, y: e.clientY};
  });
}
function startDrag(e) {
  const {n, rect, x, y} = pendingDrag;
  pendingDrag = null;
  $('context-menu').hidden = true;
  const card = element('div'), box = element('div', 'drag-box');
  card.id = 'drag-card'; card.setAttribute('aria-hidden', 'true');
  box.append(favicon(n, liveTab(state, snapshot, n.id)), element('span', 'label', n.name));
  card.append(box);
  const tile = $('favorites').querySelector('.favorite:not(.placeholder)')?.getBoundingClientRect();
  card.style.setProperty('--row-w', `${$('pinned').getBoundingClientRect().width}px`);
  card.style.setProperty('--tile-w', `${tile?.width || ($('favorites').getBoundingClientRect().width - 16) / 3}px`);
  drag = {n, card, grab: {fx: (x - rect.left) / rect.width, fy: (y - rect.top) / rect.height}, target: null, favoriteIndex: undefined, form: null};
  setForm(n.favorite ? 'tile' : 'row', true);
  document.body.append(card);
  document.body.classList.add('dragging-node');
  document.querySelector(`#sidebar [data-node-id="${CSS.escape(n.id)}"]`)?.classList.add('drag-source');
  announce(`Moving ${n.name}`);
  moveDrag(e);
}
function setForm(form, immediate = false) {
  if (drag.form === form) return;
  drag.form = form;
  const {card, grab} = drag;
  if (immediate) card.classList.add('instant');
  card.classList.toggle('tile-form', form === 'tile');
  card.classList.toggle('row-form', form === 'row');
  // Rows keep the grab point under the pointer; tiles center on it.
  card.style.setProperty('--fx', form === 'row' ? grab.fx : .5);
  card.style.setProperty('--fy', form === 'row' ? grab.fy : .5);
  if (immediate) { card.getBoundingClientRect(); card.classList.remove('instant'); }
}
function moveDrag(e) {
  drag.card.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  const area = $('scroll-area').getBoundingClientRect();
  if (e.clientY < area.top + 24 && e.clientY > area.top - 8) $('scroll-area').scrollTop -= 8;
  if (e.clientY > area.bottom - 24 && e.clientY < area.bottom + 8) $('scroll-area').scrollTop += 8;
  drag.target = dropAt(e.clientX, e.clientY);
  showDropTarget();
}
function favoriteTiles() {
  return [...$('favorites').children].filter(b => !b.classList.contains('placeholder') && b.dataset.nodeId !== drag.n.id);
}
function dropAt(x, y) {
  const el = document.elementFromPoint(x, y), n = drag.n;
  if (!el || !$('sidebar').contains(el)) return null;
  const spaceButton = el.closest('.space');
  if (spaceButton) return {el: spaceButton, into: true, move: {space: spaceButton.dataset.spaceId, pinned: true}};
  if (el.closest('#favorites')) {
    // Grid geometry does not depend on the gap being previewed, so the slot is stable.
    const grid = $('favorites'), r = grid.getBoundingClientRect(), style = getComputedStyle(grid);
    const columns = style.gridTemplateColumns.split(' ').length, gap = parseFloat(style.columnGap) || 0;
    const first = favoriteTiles()[0]?.getBoundingClientRect() || grid.querySelector('.placeholder')?.getBoundingClientRect();
    const cellW = (r.width - gap * (columns - 1)) / columns, cellH = first?.height || 49;
    const col = Math.max(0, Math.min(columns - 1, Math.floor((x - r.left) / (cellW + gap))));
    const line = Math.max(0, Math.floor((y - r.top) / (cellH + (parseFloat(style.rowGap) || 0))));
    const tiles = favoriteTiles(), index = Math.min(tiles.length, line * columns + col);
    return {favorites: index, move: {space: n.space, favorite: true, before: tiles[index]?.dataset.nodeId || null}};
  }
  const rowEl = el.closest('#scroll-area .row');
  if (rowEl && rowEl.dataset.nodeId !== n.id) {
    const target = nodeById(state, rowEl.dataset.nodeId), r = rowEl.getBoundingClientRect();
    if (!target) return null;
    if (target.type === 'folder' && y >= r.top + FOLDER_EDGE && !descendants(state, n.id).has(target.id)) {
      return {el: rowEl, into: true, move: {space: target.space, parent: target.id, pinned: true}};
    }
    const after = target.type !== 'folder' && y > r.top + r.height / 2;
    const siblings = target.pinned ? visibleNodes(state, target.parent) : visibleNodes(state, null, false).filter(s => liveTab(state, snapshot, s.id));
    const next = after ? siblings.slice(siblings.indexOf(target) + 1).find(s => s.id !== n.id) : target;
    return {line: {el: rowEl, after}, move: {space: target.space, parent: target.parent, pinned: target.pinned, before: next?.id || null}};
  }
  if (rowEl) return null;
  const pinnedArea = el.closest('#pinned, #divider');
  if (el.closest('#scroll-area')) {
    const pinned = !!pinnedArea;
    const container = $(pinned ? 'pinned' : 'tabs'), last = [...container.querySelectorAll(':scope > .row, :scope > .children > .row')].at(-1);
    return {line: last ? {el: last, after: true} : {container}, move: {space: state.activeSpace, pinned}};
  }
  return null;
}
function showDropTarget() {
  const target = drag.target;
  document.querySelectorAll('.drop-into').forEach(e => { if (e !== target?.el || !target.into) e.classList.remove('drop-into'); });
  if (target?.into) target.el.classList.add('drop-into');
  const line = $('drop-line'), area = $('scroll-area');
  line.hidden = !target?.line;
  if (target?.line) {
    const a = area.getBoundingClientRect(), base = target.line.el || target.line.container, r = base.getBoundingClientRect();
    const y = target.line.container ? r.top : target.line.after ? r.bottom + 2 : r.top - 2;
    line.style.top = `${y - a.top + area.scrollTop}px`;
    line.style.left = `${r.left - a.left + 14}px`;
  }
  setForm(target?.favorites !== undefined ? 'tile' : 'row');
  // Like Arc, the card turns into a faint slab so the insertion line shows through.
  drag.card.classList.toggle('over-line', !!target?.line);
  previewFavorites(target?.favorites ?? null);
}
// Opens a gap in Favorites for the dragged tile; a dragged favorite leaves one
// behind only while it is over the grid.
function previewFavorites(index, force = false) {
  if (!force && drag.favoriteIndex === index) return;
  drag.favoriteIndex = index;
  const grid = $('favorites'), before = motion ? new Map([...grid.children].map(b => [b.dataset.nodeId, b.getBoundingClientRect()])) : null;
  grid.querySelector('.placeholder')?.remove();
  const source = grid.querySelector(`[data-node-id="${CSS.escape(drag.n.id)}"]`);
  if (source) source.hidden = true;
  if (index !== null) {
    const gap = element('div', 'favorite placeholder');
    grid.insertBefore(gap, favoriteTiles()[index] || null);
  }
  if (!before) return;
  for (const b of grid.children) {
    const old = before.get(b.dataset.nodeId);
    if (!old || b.hidden || !b.dataset.nodeId) continue;
    const r = b.getBoundingClientRect(), dx = old.left - r.left, dy = old.top - r.top;
    if (Math.abs(dx) + Math.abs(dy) > .5) b.animate([{transform: `translate(${dx}px, ${dy}px)`}, {transform: 'none'}], {duration: 220, easing: 'cubic-bezier(.2, .8, .2, 1)'});
  }
}
// Re-applies drag feedback after a paint replaced the sidebar's rows.
function restoreDrag() {
  if (!drag) return;
  document.querySelector(`#sidebar [data-node-id="${CSS.escape(drag.n.id)}"]`)?.classList.add('drag-source');
  previewFavorites(drag.favoriteIndex, true);
  drag.target = drag.target && dropAt(...drag.card.style.transform.match(/-?[\d.]+/g).map(Number));
  showDropTarget();
}
function endDrag(commit) {
  const {n, card, target} = drag;
  drag = null; suppressClick = true; setTimeout(() => { suppressClick = false; });
  document.body.classList.remove('dragging-node');
  document.querySelectorAll('.drop-into').forEach(e => e.classList.remove('drop-into'));
  $('drop-line').hidden = true;
  const moved = commit && target && moveNode(state, n.id, target.move);
  if (moved) { save(); announce('Moved'); }
  render();
  land(card, n.id, moved ? target.el : null);
}
// The card settles onto the item's new place, or into the folder or space that
// took it when the item itself is no longer visible.
function land(card, id, into) {
  const el = document.querySelector(`#sidebar [data-node-id="${CSS.escape(id)}"]`);
  const destination = el?.getClientRects().length ? el : into?.isConnected ? into : null;
  if (!motion || !destination) { card.remove(); return; }
  const shrink = destination !== el;
  if (!shrink) { el.getAnimations().forEach(a => a.cancel()); el.style.visibility = 'hidden'; }
  const r = destination.getBoundingClientRect(), box = card.firstChild;
  card.classList.add('landing');
  card.classList.toggle('tile-form', el?.classList.contains('favorite'));
  card.classList.toggle('row-form', !el?.classList.contains('favorite'));
  card.style.setProperty('--fx', 0); card.style.setProperty('--fy', 0);
  Object.assign(box.style, shrink ? {opacity: 0, scale: .6} : {width: `${r.width}px`, height: `${r.height}px`});
  card.style.transform = `translate(${r.left + (shrink ? r.width / 4 : 0)}px, ${r.top}px)`;
  setTimeout(() => { card.remove(); if (el) el.style.visibility = ''; }, 200);
}
document.addEventListener('pointermove', e => {
  if (pendingDrag && !drag && Math.hypot(e.clientX - pendingDrag.x, e.clientY - pendingDrag.y) > 4) startDrag(e);
  else if (drag) moveDrag(e);
});
document.addEventListener('pointerup', () => { pendingDrag = null; if (drag) endDrag(true); });
document.addEventListener('pointercancel', () => { pendingDrag = null; if (drag) endDrag(false); });
document.addEventListener('click', e => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; } }, true);
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
  return el;
}
function fillSpace(pinned, tabs, empty) {
  renderTree(pinned);
  for (const n of visibleNodes(state, null, false)) {
    // Dormant unpinned nodes from other windows never appear in this window.
    if (liveTab(state, snapshot, n.id)) tabs.append(row(n));
  }
  empty.hidden = tabs.childElementCount > 0;
}
function renderTree(container, parent = null, level = 1) {
  for (const n of visibleNodes(state, parent)) {
    container.append(row(n, level));
    if (n.type === 'folder' && !n.collapsed) {
      const children = element('div', 'children'); children.setAttribute('role', 'group'); renderTree(children, n.id, level + 1); container.append(children);
    }
  }
}
// Space changes slide the carousel; everything else paints in place and
// animates the difference between the old and new DOM.
function render() {
  const from = shownSpace, to = state.activeSpace;
  const ids = state.spaces.map(s => s.id), a = ids.indexOf(from), b = ids.indexOf(to);
  const direction = spaceDirection || (b > a ? 1 : -1);
  spaceDirection = 0;
  if (!motion || !painted || from === to || a < 0) { cancelSwipe(); return paint(); }
  slideSpace(direction);
}
function paint() {
  const animate = motion && painted && shownSpace === state.activeSpace && !slide;
  const before = animate ? measure() : null;
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
    const button = element('button', `favorite ${tab?.active ? 'active' : ''}`); button.dataset.nodeId = n.id; button.title = n.name; button.setAttribute('aria-label', n.name); button.setAttribute('aria-pressed', String(!!tab?.active)); button.append(favicon(n, tab));
    button.addEventListener('click', () => activate(n));
    button.addEventListener('contextmenu', e => { e.preventDefault(); nodeMenu(n, {x: e.clientX, y: e.clientY}); });
    dragSource(button, n); $('favorites').append(button);
  }
  fillSpace($('pinned'), $('tabs'), $('empty'));
  for (const s of state.spaces) {
    const button = element('button', 'space', s.icon); button.title = s.name; button.setAttribute('aria-label', `${s.name} space`); button.setAttribute('aria-current', String(s.id === state.activeSpace));
    if (s.id === state.activeSpace) button.append(element('span', 'space-dot'));
    button.addEventListener('click', () => switchSpace(s.id));
    button.addEventListener('contextmenu', e => { e.preventDefault(); spaceMenu(s, {x: e.clientX, y: e.clientY}); });
    button.dataset.spaceId = s.id; $('spaces').append(button);
  }
  if (focused) document.querySelector(`#sidebar [data-node-id="${CSS.escape(focused)}"]`)?.focus({preventScroll: true});
  shownSpace = state.activeSpace; painted = true;
  if (before) animateChanges(before);
  restoreDrag();
  document.dispatchEvent(new CustomEvent('arc-render', {detail: {state, snapshot}}));
}
function measure() {
  const nodes = new Map();
  for (const el of document.querySelectorAll('#sidebar [data-node-id]')) {
    nodes.set(el.dataset.nodeId, {el, rect: el.getBoundingClientRect(), active: el.classList.contains('active'), expanded: el.getAttribute('aria-expanded')});
  }
  return {nodes, area: $('scroll-area').getBoundingClientRect()};
}
// Timings measured from Arc at 24fps. Opened rows fade in at full height in
// ~125ms; closed rows fade out in place in ~80ms while the rows around them
// slide into place, most of the way within the first frame. Selection changes
// in place: the newly selected row fills from its hover state and the previous
// one clears at once.
const LIST_EASING = 'cubic-bezier(.25, 1, .5, 1)';
function animateChanges({nodes, area}) {
  const hover = getComputedStyle(root).getPropertyValue('--hover');
  for (const el of document.querySelectorAll('#sidebar [data-node-id]')) {
    const old = nodes.get(el.dataset.nodeId);
    nodes.delete(el.dataset.nodeId);
    if (!old) {
      el.animate([{opacity: 0}, {opacity: 1}], {duration: 125, easing: 'ease-out'});
      continue;
    }
    const rect = el.getBoundingClientRect(), dx = old.rect.left - rect.left, dy = old.rect.top - rect.top;
    if (Math.abs(dx) + Math.abs(dy) > .5) el.animate([{transform: `translate(${dx}px, ${dy}px)`}, {transform: 'none'}], {duration: 150, easing: LIST_EASING});
    if (el.classList.contains('row') && el.classList.contains('active') && !old.active) {
      el.animate([{offset: 0, backgroundColor: hover, boxShadow: 'none'}], {duration: 90, easing: 'ease-out'});
    }
    const expanded = el.getAttribute('aria-expanded');
    if (old.expanded && expanded && old.expanded !== expanded) {
      el.querySelector('.disclosure svg')?.animate([{transform: `rotate(${old.expanded === 'true' ? 90 : 0}deg)`}, {transform: `rotate(${expanded === 'true' ? 90 : 0}deg)`}], {duration: 180, easing: 'ease-out'});
    }
  }
  for (const old of nodes.values()) ghost(old, area);
}
// A non-interactive visual copy of part of the sidebar. Copies of whole space
// pages keep their ids for styling; they are always inserted after the live
// page, so getElementById() keeps resolving to the live elements.
function strip(el, keepIds = false) {
  for (const e of [el, ...el.querySelectorAll('*')]) {
    if (!keepIds) e.removeAttribute('id');
    e.removeAttribute('role'); e.removeAttribute('tabindex'); e.removeAttribute('data-node-id'); e.removeAttribute('aria-label');
  }
}
function inertCopy(el, keepIds = false) {
  const copy = el.cloneNode(true);
  strip(copy, keepIds);
  copy.classList.remove('drop-into', 'drag-source');
  copy.setAttribute('aria-hidden', 'true'); copy.inert = true;
  return copy;
}
function ghost({el, rect}, area) {
  if (!rect.height || !rect.width) return;
  const copy = inertCopy(el);
  copy.classList.add('ghost');
  Object.assign(copy.style, {left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`});
  if (el.classList.contains('row')) copy.style.clipPath = `inset(${Math.max(0, area.top - rect.top)}px 0 ${Math.max(0, rect.bottom - area.bottom)}px 0)`;
  document.body.append(copy);
  const done = () => copy.remove();
  copy.animate([{opacity: 1}, {opacity: 0}], {duration: 80, easing: 'linear', fill: 'forwards'}).finished.then(done, done);
}
// Space carousel. Each space is a page one sidebar-width apart; neighbors are
// rendered off-stage so a swipe shows the next space beside the current one.
function neighbor(direction) {
  const i = state.spaces.findIndex(s => s.id === state.activeSpace);
  return state.spaces[(i + direction + state.spaces.length) % state.spaces.length];
}
function offstagePage(space) {
  const page = $('space-content').cloneNode(true), current = state.activeSpace;
  page.classList.add('offstage'); page.inert = true; page.setAttribute('aria-hidden', 'true');
  const pinned = page.querySelector('#pinned'), tabs = page.querySelector('#tabs');
  pinned.replaceChildren(); tabs.replaceChildren();
  page.querySelector('#space-title').textContent = space.name;
  state.activeSpace = space.id;
  try { fillSpace(pinned, tabs, page.querySelector('#empty')); } finally { state.activeSpace = current; }
  // Arc shows each space with the tab it will reopen already selected.
  for (const el of page.querySelectorAll('.row')) el.classList.toggle('active', el.dataset.nodeId === state.lastActive[space.id]);
  strip(page, true);
  $('space-viewport').append(page);
  return page;
}
function slideSpace(direction) {
  slide?.finish();
  const content = $('space-content'), width = $('space-viewport').clientWidth;
  const offset = swipe?.direction === direction ? swipe.offset : 0;
  cancelSwipe(true);
  const outgoing = inertCopy(content, true), scrollTop = $('scroll-area').scrollTop;
  outgoing.classList.add('offstage');
  $('space-viewport').append(outgoing);
  outgoing.querySelector('#scroll-area').scrollTop = scrollTop;
  paint();
  $('scroll-area').scrollTop = 0;
  content.style.transform = '';
  // Both pages move together; a swipe continues from where the fingers left it.
  const options = {duration: offset ? 300 : 420, easing: spring};
  const incoming = content.animate([{transform: `translateX(${offset + direction * width}px)`}, {transform: 'none'}], options);
  const leaving = outgoing.animate([{transform: `translateX(${offset}px)`}, {transform: `translateX(${-direction * width}px)`}], {...options, fill: 'forwards'});
  const current = slide = {finish() { incoming.finish(); leaving.finish(); }};
  const done = () => { outgoing.remove(); if (slide === current) slide = null; };
  leaving.finished.then(done, done);
}
function moveSwipe() {
  const width = $('space-viewport').clientWidth;
  $('space-content').style.transform = `translateX(${swipe.offset}px)`;
  swipe.page.style.transform = `translateX(${swipe.offset + swipe.direction * width}px)`;
}
function cancelSwipe(keepOffset = false) {
  if (!swipe) return;
  clearTimeout(swipe.timer);
  swipe.page.remove();
  if (!keepOffset) $('space-content').style.transform = '';
  swipe = null;
}
function releaseSwipe() {
  const width = $('space-viewport').clientWidth, {offset, direction, velocity, target} = swipe;
  swipe.timer = 0;
  if (Math.abs(offset) > width * .25 || (Math.abs(velocity) > 6 && Math.sign(-velocity) === direction)) {
    switchSpace(target.id, direction);
    swipeQuiet = true;
    return;
  }
  const {page} = swipe, options = {duration: 280, easing: spring};
  swipe = null;
  const back = $('space-content').animate([{transform: `translateX(${offset}px)`}, {transform: 'none'}], options);
  $('space-content').style.transform = '';
  page.style.transform = '';
  const done = () => page.remove();
  page.animate([{transform: `translateX(${offset + direction * width}px)`}, {transform: `translateX(${direction * width}px)`}], {...options, fill: 'forwards'}).finished.then(done, done);
  back.finished.catch(() => {});
}
function menu(items, position) {
  const target = $('context-menu'); target.replaceChildren();
  for (const item of items) {
    if (!item) { target.append(document.createElement('hr')); continue; }
    const button = element('button', item.danger ? 'danger' : '', item.label);
    button.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
    if (item.checked !== undefined) button.setAttribute('aria-checked', String(item.checked));
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
  items.push(null, {label: 'Sidebar animations', checked: animations, run: () => {
    animations = !animations; setMotion(); send('setAnimations', {enabled: animations});
    announce(`Sidebar animations ${animations ? 'on' : 'off'}`);
  }});
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
document.addEventListener('pointerdown', e => { if (!$('context-menu').contains(e.target)) $('context-menu').hidden = true; });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { $('context-menu').hidden = true; if (drag) endDrag(false); }
  if (!$('context-menu').hidden && ['ArrowDown', 'ArrowUp'].includes(e.key)) {
    e.preventDefault(); const buttons = [...$('context-menu').querySelectorAll('button')]; const i = buttons.indexOf(document.activeElement); buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus(); return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 't') { e.preventDefault(); if (!$('command-dialog').open) commandPalette(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') { e.preventDefault(); window.arcSidebar.focusAddress(); }
  if ((e.metaKey || e.ctrlKey) && e.altKey && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault(); const i = state.spaces.findIndex(s => s.id === state.activeSpace); switchSpace(state.spaces[(i + (e.key === 'ArrowRight' ? 1 : state.spaces.length - 1)) % state.spaces.length].id, e.key === 'ArrowRight' ? 1 : -1);
  }
  if (['ArrowDown', 'ArrowUp'].includes(e.key) && document.activeElement?.matches('.row')) {
    e.preventDefault(); const rows = [...document.querySelectorAll('#sidebar .row')]; const i = rows.indexOf(document.activeElement); rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  }
});
let swipeTotal = 0, swipeAt = 0, swipeQuiet = false, quietTimer = 0;
$('sidebar').addEventListener('wheel', e => {
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || state.spaces.length < 2) return;
  e.preventDefault();
  if (!motion) {
    const now = performance.now();
    if (now - swipeAt > 250) swipeTotal = 0;
    if (swipeAt > now) return;
    swipeTotal += e.deltaX; swipeAt = now;
    if (Math.abs(swipeTotal) > 100) {
      switchSpace(neighbor(swipeTotal > 0 ? 1 : -1).id, swipeTotal > 0 ? 1 : -1);
      swipeTotal = 0; swipeAt = now + 350;
    }
    return;
  }
  // After a committed swipe, ignore the rest of the gesture and its momentum.
  if (swipeQuiet) {
    clearTimeout(quietTimer); quietTimer = setTimeout(() => { swipeQuiet = false; }, 150);
    return;
  }
  // The space follows the fingers 1:1, with the neighboring space alongside.
  slide?.finish();
  const width = $('space-viewport').clientWidth;
  const offset = Math.max(-width, Math.min(width, (swipe?.offset ?? 0) - e.deltaX));
  const direction = offset < 0 ? 1 : -1;
  if (!swipe || swipe.direction !== direction) {
    const previous = swipe; cancelSwipe(true); clearTimeout(previous?.timer);
    const target = neighbor(direction);
    swipe = {direction, target, page: offstagePage(target), offset, velocity: 0, timer: 0};
  }
  swipe.offset = offset; swipe.velocity = -e.deltaX;
  moveSwipe();
  clearTimeout(swipe.timer);
  if (Math.abs(offset) >= width * .6) return releaseSwipe();
  swipe.timer = setTimeout(releaseSwipe, 120);
}, {passive: false});
if (native) {
  if (navigator.platform.includes('Mac')) document.body.classList.add('native-mac');
  send('ready');
} else {
  document.body.classList.add('preview');
  await import('./preview.mjs');
  send('ready');
}
