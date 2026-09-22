import test from 'node:test';
import assert from 'node:assert/strict';
import {createState, restoreState, addFolder, addSpace, deleteSpace, moveNode, removeNode, descendants, reconcile, liveTab, safeURL} from '../../resources/arc_sidebar/model.mjs';
const snap = (tabs, windowId = 1) => ({windowId, tabs});
const tab = (id, url = 'https://example.com/', active = false) => ({id, title: `Tab ${id}`, url, active});
test('folders reject cycles and keep descendants together when moving spaces', () => {
  const s = createState(), a = addFolder(s, 'A'), b = addFolder(s, 'B', a.id), c = addFolder(s, 'C', b.id);
  assert.equal(moveNode(s, a.id, {parent: c.id}), false);
  const work = addSpace(s, 'Work');
  assert.equal(moveNode(s, a.id, {space: work.id}), true);
  assert.deepEqual(new Set(s.nodes.map(n => n.space)), new Set([work.id]));
  assert.equal(b.parent, a.id); assert.equal(c.parent, b.id);
});
test('moving into a folder pins the tab, moving to today unpins it', () => {
  const s = createState(); reconcile(s, snap([tab(1)]));
  const n = s.nodes[0], f = addFolder(s, 'Research');
  assert.equal(moveNode(s, n.id, {parent: f.id, pinned: false}), true);
  assert.equal(n.pinned, true); assert.equal(n.parent, f.id);
  moveNode(s, n.id, {pinned: false}); assert.equal(n.parent, null); assert.equal(n.pinned, false);
});
test('favorites survive closure, ordinary tabs are removed', () => {
  const s = createState(); reconcile(s, snap([tab(1), tab(2)]));
  const n = s.nodes[0]; moveNode(s, n.id, {favorite: true});
  reconcile(s, snap([])); assert.equal(s.nodes.length, 1); assert.equal(s.nodes[0].id, n.id);
});
test('duplicate URLs restore to separate pinned entries', () => {
  const s = createState(); reconcile(s, snap([tab(1), tab(2)]));
  s.nodes.forEach(n => { n.pinned = true; }); reconcile(s, snap([]));
  reconcile(s, snap([tab(3), tab(4)]));
  assert.equal(s.nodes.length, 2); assert.notEqual(s.bindings['1:3'], s.bindings['1:4']);
});
test('node tokens bind reopened pins without changing their home URL or title', () => {
  const s = createState(); reconcile(s, snap([tab(1)])); const n = s.nodes[0]; n.pinned = true;
  reconcile(s, snap([])); reconcile(s, snap([{...tab(7, 'https://example.com/next'), nodeId: n.id}]));
  assert.equal(s.nodes.length, 1); assert.equal(liveTab(s, snap([tab(7)]), n.id).id, 7);
  assert.equal(n.url, 'https://example.com/'); assert.equal(n.name, 'Tab 1');
});
test('updates from another window do not remove this window’s tab assignments', () => {
  const s = createState(); reconcile(s, snap([tab(1)]));
  reconcile(s, snap([tab(5, 'https://other.example/')], 2));
  assert.ok(s.bindings['1:1']); assert.ok(s.bindings['2:5']);
});
test('deleting spaces preserves their entire folder hierarchy', () => {
  const s = createState(), folder = addFolder(s, 'Keep me'), child = addFolder(s, 'Child', folder.id), work = addSpace(s, 'Work');
  assert.equal(deleteSpace(s, 'personal'), true); assert.equal(s.activeSpace, work.id);
  assert.equal(child.parent, folder.id); assert.equal(child.space, work.id);
  assert.equal(deleteSpace(s, work.id), false);
});
test('removing a folder removes descendants and bindings without affecting siblings', () => {
  const s = createState(), a = addFolder(s, 'A'), b = addFolder(s, 'B', a.id), sibling = addFolder(s, 'Sibling');
  reconcile(s, snap([tab(1)])); const n = s.nodes.find(n => n.type === 'tab'); moveNode(s, n.id, {parent: b.id});
  assert.equal(descendants(s, a.id).size, 3); removeNode(s, a.id);
  assert.deepEqual(s.nodes.map(n => n.id), [sibling.id]); assert.deepEqual(s.bindings, {});
});
test('hostile or corrupt persisted trees are repaired and unsupported URLs rejected', () => {
  const s = createState(), a = addFolder(s, 'A'), b = addFolder(s, 'B', a.id); a.parent = b.id;
  s.nodes.push({id: 'bad', type: 'tab', name: '<img onerror=alert(1)>', url: 'javascript:alert(1)', space: 'personal'});
  s.spaces[0].color = 'red;position:fixed'; const restored = restoreState(s);
  assert.equal(restored.nodes.find(n => n.id === 'bad').url, '');
  assert.equal(restored.spaces[0].color, '#f6a3a9'); assert.equal(restored.nodes[0].parent, null);
  assert.equal(safeURL('data:text/html,test'), ''); assert.equal(safeURL('https://example.com/'), 'https://example.com/');
});
test('workspace roundtrip preserves folder order, collapsed state, and color', () => {
  const s = createState(), f = addFolder(s, 'Trip'); f.collapsed = true; addFolder(s, 'Docs', f.id);
  const next = addSpace(s, 'Writing', '#b7a0d8'); s.activeSpace = next.id;
  const restored = restoreState(JSON.parse(JSON.stringify(s)));
  assert.equal(restored.nodes[0].collapsed, true); assert.equal(restored.nodes[1].parent, f.id); assert.equal(restored.activeSpace, next.id);
});
