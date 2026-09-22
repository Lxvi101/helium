import {test, before, after, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root = fileURLToPath(new URL('../../', import.meta.url));
let browser, server, context, page;
const errors = [];
before(async () => {
  server = spawn('python3', ['-m', 'http.server', '4174', '--bind', '127.0.0.1'], {cwd: root, stdio: 'ignore'});
  let connected = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch('http://127.0.0.1:4174/resources/arc_sidebar/index.html')).ok) { connected = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(connected, 'preview server started');
  browser = await chromium.launch({headless: true, ...(process.env.ARC_CHROME_PATH ? {executablePath: process.env.ARC_CHROME_PATH} : {})});
});
after(async () => { await browser?.close(); server?.kill(); });
beforeEach(async () => {
  errors.length = 0;
  context = await browser.newContext({viewport: {width: 260, height: 800}, reducedMotion: 'reduce'});
  page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:4174/resources/arc_sidebar/index.html');
  await page.getByRole('treeitem', {name: 'MMMHome', exact: true}).waitFor();
});
afterEach(async () => { assert.deepEqual(errors, [], 'no uncaught browser errors'); await context?.close(); });
async function createFolder(name) {
  await page.getByRole('button', {name: 'Add folder or space', exact: true}).click();
  await page.getByRole('menuitem', {name: 'New folder', exact: true}).click();
  await page.getByRole('textbox', {name: 'Name', exact: true}).fill(name);
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await page.getByRole('treeitem', {name, exact: true}).waitFor();
}
async function menuOn(name, action) {
  await page.getByRole('treeitem', {name, exact: true}).click({button: 'right'});
  await page.getByRole('menuitem', {name: action, exact: true}).click();
}
test('reference layout: nested folders, favorites, active tab, no horizontal overflow', async () => {
  assert.equal(await page.locator('#favorites button').count(), 3);
  assert.equal(await page.getByRole('treeitem', {name: 'Travel Docs', exact: true}).getAttribute('aria-level'), '2');
  assert.equal(await page.getByRole('treeitem', {name: 'MMMHome', exact: true}).getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 260);
  await page.screenshot({path: `${root}/build/arc-sidebar-personal.png`});
});
test('folder create, rename, collapse, and persistence through reload', async () => {
  await createFolder('Research');
  await menuOn('Research', 'Rename');
  await page.getByRole('textbox', {name: 'Name', exact: true}).fill('Reading');
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await page.getByRole('treeitem', {name: 'Merida Trip', exact: true}).click();
  assert.equal(await page.getByRole('treeitem', {name: 'Travel Docs', exact: true}).count(), 0);
  await page.reload();
  await page.getByRole('treeitem', {name: 'Reading', exact: true}).waitFor();
  assert.equal(await page.getByRole('treeitem', {name: 'Merida Trip', exact: true}).getAttribute('aria-expanded'), 'false');
});
test('drag tabs into nested folders, and drag folders across spaces', async () => {
  await page.getByRole('treeitem', {name: 'Spotify', exact: true}).dragTo(page.getByRole('treeitem', {name: 'Travel Docs', exact: true}));
  assert.equal(await page.getByRole('treeitem', {name: 'Spotify', exact: true}).getAttribute('aria-level'), '3');
  await page.getByRole('treeitem', {name: 'Merida Trip', exact: true}).dragTo(page.getByRole('button', {name: 'Work space', exact: true}));
  assert.equal(await page.getByRole('treeitem', {name: 'Merida Trip', exact: true}).count(), 0);
  await page.getByRole('button', {name: 'Work space', exact: true}).click();
  await page.getByRole('treeitem', {name: 'Spotify', exact: true}).waitFor();
  assert.equal(await page.getByRole('treeitem', {name: 'Spotify', exact: true}).getAttribute('aria-level'), '3');
});
test('spaces create, recolor, switch, and retain their own active tabs', async () => {
  await page.getByRole('button', {name: 'Add folder or space', exact: true}).click();
  await page.getByRole('menuitem', {name: 'New space', exact: true}).click();
  await page.getByRole('textbox', {name: 'Name', exact: true}).fill('Studio');
  await page.getByRole('button', {name: '#9bbec4', exact: true}).click();
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  assert.equal(await page.getByRole('button', {name: 'Studio space', exact: true}).getAttribute('aria-current'), 'true');
  await page.getByRole('button', {name: 'Personal space', exact: true}).click();
  assert.equal(await page.getByRole('treeitem', {name: 'MMMHome', exact: true}).getAttribute('aria-selected'), 'true');
  await page.getByRole('button', {name: 'Studio space', exact: true}).click();
  assert.equal(await page.getByRole('treeitem', {name: 'New Tab', exact: true}).count(), 1);
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--space').trim()), '#9bbec4');
});
test('palette opens a new tab, pins survive closing and reopen once', async () => {
  await page.locator('#new-tab').click();
  await page.getByRole('textbox', {name: 'Search tabs or enter URL', exact: true}).fill('https://example.org/');
  await page.getByRole('textbox', {name: 'Search tabs or enter URL', exact: true}).press('Enter');
  await page.getByRole('treeitem', {name: 'example.org', exact: true}).waitFor();
  await menuOn('example.org', 'Pin tab');
  await page.getByRole('treeitem', {name: 'example.org', exact: true}).hover();
  await page.getByRole('button', {name: 'Close example.org', exact: true}).click();
  assert.equal(await page.getByRole('treeitem', {name: 'example.org', exact: true}).count(), 1);
  await page.getByRole('treeitem', {name: 'example.org', exact: true}).click();
  assert.equal(await page.getByRole('treeitem', {name: 'example.org', exact: true}).getAttribute('aria-selected'), 'true');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('helium-arc-preview')));
  assert.equal(saved.tabs.filter(t => t.url === 'https://example.org/').length, 1);
});
test('keyboard tree navigation and hostile titles render as text', async () => {
  await createFolder('<img src=x onerror=alert(1)>');
  assert.equal(await page.locator('#pinned img[src=x]').count(), 0);
  await page.getByRole('treeitem', {name: 'Merida Trip', exact: true}).focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.getByRole('treeitem', {name: 'Travel Docs', exact: true}).count(), 0);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Travel Docs');
});
test('folders reorder at the leading edge without becoming nested', async () => {
  await createFolder('Reading');
  const source = page.getByRole('treeitem', {name: 'Reading', exact: true});
  const target = page.getByRole('treeitem', {name: 'Merida Trip', exact: true});
  await source.dragTo(target, {targetPosition: {x: 80, y: 3}});
  assert.equal(await source.getAttribute('aria-level'), '1');
  const rows = await page.locator('#pinned > .row').allTextContents();
  assert.ok(rows.findIndex(x => x.includes('Reading')) < rows.findIndex(x => x.includes('Merida Trip')));
});
test('horizontal trackpad gestures switch spaces', async () => {
  await page.locator('#sidebar').dispatchEvent('wheel', {deltaX: 130, deltaY: 0});
  assert.equal(await page.getByRole('button', {name: 'Work space', exact: true}).getAttribute('aria-current'), 'true');
});
