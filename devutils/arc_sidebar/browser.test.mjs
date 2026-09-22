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
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--space')), '#9bbec4');
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
async function withMotion(run) {
  const motionContext = await browser.newContext({viewport: {width: 260, height: 800}, reducedMotion: 'no-preference'});
  const motionPage = await motionContext.newPage();
  const motionErrors = [];
  motionPage.on('pageerror', e => motionErrors.push(e.message));
  try {
    await motionPage.goto('http://127.0.0.1:4174/resources/arc_sidebar/index.html');
    await motionPage.getByRole('treeitem', {name: 'MMMHome', exact: true}).waitFor();
    await run(motionPage);
    assert.deepEqual(motionErrors, [], 'no uncaught browser errors with animations');
  } finally { await motionContext.close(); }
}
const settled = p => p.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running'));
test('animations follow the preference and the system reduced-motion setting', async () => {
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('motion')), false);
  await withMotion(async p => {
    assert.equal(await p.evaluate(() => document.documentElement.classList.contains('motion')), true);
    await p.getByRole('button', {name: 'Space options', exact: true}).click();
    const toggle = p.getByRole('menuitemcheckbox', {name: 'Sidebar animations', exact: true});
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    await toggle.click();
    assert.equal(await p.evaluate(() => document.documentElement.classList.contains('motion')), false);
    await p.reload();
    await p.getByRole('treeitem', {name: 'MMMHome', exact: true}).waitFor();
    assert.equal(await p.evaluate(() => document.documentElement.classList.contains('motion')), false);
  });
});
test('space switches slide the carousel with both spaces side by side', async () => {
  await withMotion(async p => {
    await p.getByRole('button', {name: 'Work space', exact: true}).click();
    const during = await p.evaluate(() => {
      const [page] = document.querySelectorAll('.space-page.offstage');
      return {pages: document.querySelectorAll('.space-page.offstage').length, outgoing: page?.querySelector('#space-title').textContent, color: document.documentElement.style.getPropertyValue('--space')};
    });
    assert.deepEqual(during, {pages: 1, outgoing: 'Personal', color: '#b7a0d8'});
    await settled(p);
    assert.equal(await p.locator('.space-page.offstage').count(), 0);
    assert.equal(await p.locator('#space-title').textContent(), 'Work');
    assert.equal(await p.getByRole('treeitem', {name: 'Apple Updates', exact: true}).count(), 1);
  });
});
test('trackpad swipes track the fingers, then commit or spring back', async () => {
  await withMotion(async p => {
    const wheel = deltaX => p.locator('#sidebar').dispatchEvent('wheel', {deltaX, deltaY: 0});
    for (let i = 0; i < 4; i++) await wheel(5);
    const tracked = await p.evaluate(() => ({
      content: document.getElementById('space-content').style.transform,
      peek: document.querySelector('.space-page.offstage #space-title').textContent,
      color: document.documentElement.style.getPropertyValue('--space'),
    }));
    assert.deepEqual(tracked, {content: 'translateX(-20px)', peek: 'Work', color: '#f6a3a9'});
    await p.waitForTimeout(200); await settled(p);
    assert.equal(await p.locator('#space-title').textContent(), 'Personal');
    assert.equal(await p.locator('.space-page.offstage').count(), 0);
    for (let i = 0; i < 8; i++) await wheel(12);
    await p.waitForTimeout(200); await settled(p);
    assert.equal(await p.locator('#space-title').textContent(), 'Work');
    assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('space-content')).transform), 'none');
    assert.equal(await p.locator('.space-page.offstage').count(), 0);
  });
});
test('tab switching selects the row in place', async () => {
  await withMotion(async p => {
    await p.locator('#new-tab').click();
    await p.getByRole('textbox', {name: 'Search tabs or enter URL', exact: true}).fill('https://example.org/');
    await p.getByRole('textbox', {name: 'Search tabs or enter URL', exact: true}).press('Enter');
    await p.getByRole('treeitem', {name: 'example.org', exact: true}).waitFor();
    await p.getByRole('treeitem', {name: 'MMMHome', exact: true}).click();
    await settled(p);
    const row = p.getByRole('treeitem', {name: 'MMMHome', exact: true});
    assert.equal(await row.getAttribute('aria-selected'), 'true');
    assert.notEqual(await row.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
    assert.equal(await p.getByRole('treeitem', {name: 'example.org', exact: true}).evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
    await p.getByRole('treeitem', {name: 'Merida Trip', exact: true}).click();
    await settled(p);
    assert.equal(await p.locator('.ghost').count(), 0);
  });
});
test('drag and drop shows Arc feedback: folder fill, insertion line, and a gap in Favorites', async () => {
  await withMotion(async p => {
    const box = async name => p.getByRole('treeitem', {name, exact: true}).boundingBox();
    const s = await box('Spotify');
    await p.mouse.move(s.x + 60, s.y + 20); await p.mouse.down();
    const folder = await box('Merida Trip');
    await p.mouse.move(folder.x + 60, folder.y + 22, {steps: 4});
    assert.equal(await p.locator('.row.drop-into').getAttribute('aria-label'), 'Merida Trip');
    assert.equal(await p.locator('#drag-card.row-form').count(), 1);
    const nested = await box('Travel Docs');
    await p.mouse.move(nested.x + 60, nested.y + 3, {steps: 3});
    assert.equal(await p.locator('#drop-line').isVisible(), true);
    assert.equal(await p.locator('.row.drop-into').count(), 0);
    const tile = await p.locator('#favorites button').nth(1).boundingBox();
    await p.mouse.move(tile.x + 10, tile.y + 25, {steps: 4});
    assert.equal(await p.locator('#drag-card.tile-form').count(), 1);
    assert.equal(await p.evaluate(() => [...document.getElementById('favorites').children].findIndex(e => e.classList.contains('placeholder'))), 1);
    await p.mouse.up(); await settled(p); await p.waitForTimeout(250);
    assert.equal(await p.locator('#drag-card').count(), 0);
    assert.deepEqual(await p.locator('#favorites button').evaluateAll(b => b.map(e => e.getAttribute('aria-label'))), ['Notes', 'Spotify', 'Gmail', 'Instapaper']);
    assert.equal(await p.getByRole('treeitem', {name: 'Spotify', exact: true}).count(), 0);
  });
});
test('dragging a favorite out closes its gap and returns it to the list', async () => {
  await withMotion(async p => {
    const tile = await p.locator('#favorites button').first().boundingBox();
    await p.mouse.move(tile.x + 20, tile.y + 20); await p.mouse.down();
    const pinned = await p.getByRole('treeitem', {name: 'Spotify', exact: true}).boundingBox();
    await p.mouse.move(pinned.x + 60, pinned.y + 30, {steps: 5});
    assert.equal(await p.locator('#drop-line').isVisible(), true);
    assert.equal(await p.locator('#favorites .placeholder').count(), 0);
    assert.equal(await p.locator('#favorites button:not([hidden])').count(), 2);
    assert.equal(await p.locator('#drag-card.row-form').count(), 1);
    await p.mouse.up(); await settled(p);
    assert.equal(await p.locator('#favorites button').count(), 2);
    assert.equal(await p.getByRole('treeitem', {name: 'Notes', exact: true}).count(), 1);
  });
});
