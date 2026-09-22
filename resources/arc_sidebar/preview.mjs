// Development-only in-memory browser adapter. Never bundled into Helium.
import {createState, addFolder, addSpace} from './model.mjs';
let saved;
try { saved = JSON.parse(localStorage.getItem('helium-arc-preview')); } catch {}
let state = saved?.state || createState();
let tabs = saved?.tabs;
let animations = saved?.animations !== false;
let nextId = Math.max(0, ...(tabs || []).map(t => t.id)) + 1;
if (!tabs) {
  const nodes = [
    {id: 'fav-notes', name: 'Notes', url: 'https://notes.example/', favorite: true},
    {id: 'fav-mail', name: 'Gmail', url: 'https://mail.google.com/', favorite: true},
    {id: 'fav-read', name: 'Instapaper', url: 'https://www.instapaper.com/', favorite: true},
    {id: 'spotify', name: 'Spotify', url: 'https://open.spotify.com/'},
  ];
  state.nodes.push(...nodes.map(n => ({...n, type: 'tab', space: state.activeSpace, parent: null, pinned: true})));
  const trip = addFolder(state, 'Merida Trip');
  addFolder(state, 'Travel Docs', trip.id);
  const work = addSpace(state, 'Work', '#b7a0d8');
  const personal = state.activeSpace;
  state.activeSpace = work.id;
  const apple = addFolder(state, 'Apple Updates');
  state.nodes.push(...[
    ['TidBITS Articles', 'https://tidbits.com/', null],
    ['Arc Will Change the Way You…', 'https://docs.google.com/', null],
    ['2023-05 May TCN Content', 'https://docs.google.com/document/', null],
    ['Pie Register', 'https://tidbits.com/register/', null],
    ['Posts', 'https://tidbits.com/posts/', null],
    ['Watchlist', 'https://tidbits.com/watchlist/', null],
    ['Issues', 'https://tidbits.com/issues/', null],
    ['Media Library', 'https://tidbits.com/media/', null],
    ['Users', 'https://tidbits.com/users/', null],
    ['Apple Newsroom', 'https://www.apple.com/newsroom/', apple.id],
    ['Apple Security Updates', 'https://support.apple.com/', apple.id],
  ].map(([name, url, parent], i) => ({id: `work-${i}`, type: 'tab', name, url, parent, space: work.id, pinned: true})));
  // Keep the folder after the work pins, as in the second reference.
  state.nodes = state.nodes.filter(n => n !== apple).concat(apple);
  state.activeSpace = personal;
  tabs = [{id: nextId++, title: 'MMMHome', url: 'https://mmmhome.io/', active: true}];
}
const history = new Map(tabs.map(t => [t.id, {urls: [t.url], index: 0}]));
function persist() { localStorage.setItem('helium-arc-preview', JSON.stringify({state, tabs, animations})); }
function emit() {
  const active = tabs.find(t => t.active), h = history.get(active?.id);
  window.arcSidebar.receive({windowId: 1, state: structuredClone(state), tabs: structuredClone(tabs), animations, canGoBack: !!h && h.index > 0, canGoForward: !!h && h.index < h.urls.length - 1});
}
function navigate(url) {
  if (!url.includes(':')) url = url.includes('.') && !url.includes(' ') ? `https://${url}` : `https://duckduckgo.com/?q=${encodeURIComponent(url)}`;
  const tab = tabs.find(t => t.active); if (!tab) return;
  tab.url = url; tab.title = url === 'chrome://newtab/' ? 'New Tab' : new URL(url).hostname;
  const h = history.get(tab.id); h.urls = h.urls.slice(0, h.index + 1); h.urls.push(url); h.index++;
}
window.arcPreview = {send(action, data) {
  if (action === 'save') { state = structuredClone(data.state); persist(); return; }
  if (action === 'setAnimations') animations = !!data.enabled;
  if (action === 'activate') tabs.forEach(t => { t.active = t.id === data.tabId; });
  if (action === 'open' || action === 'settings') {
    tabs.forEach(t => { t.active = false; });
    const tab = {id: nextId++, url: 'chrome://newtab/', title: 'New Tab', active: true, nodeId: data.nodeId};
    tabs.push(tab); history.set(tab.id, {urls: [tab.url], index: 0});
    navigate(action === 'settings' ? 'chrome://settings/' : data.url);
  }
  if (action === 'navigate') { if (data.tabId) tabs.forEach(t => { t.active = t.id === data.tabId; }); navigate(data.url); }
  if (action === 'close') {
    const wasActive = tabs.find(t => t.id === data.tabId)?.active;
    tabs = tabs.filter(t => t.id !== data.tabId);
    if (wasActive && tabs.length) tabs.at(-1).active = true;
  }
  if (action === 'back' || action === 'forward') {
    const tab = tabs.find(t => t.active), h = history.get(tab?.id);
    if (h) { h.index = Math.max(0, Math.min(h.urls.length - 1, h.index + (action === 'back' ? -1 : 1))); tab.url = h.urls[h.index]; }
  }
  if (action === 'copyURL') navigator.clipboard?.writeText(tabs.find(t => t.active)?.url || '');
  if (action === 'collapse') document.body.classList.toggle('preview-collapsed');
  persist(); queueMicrotask(emit);
}};
