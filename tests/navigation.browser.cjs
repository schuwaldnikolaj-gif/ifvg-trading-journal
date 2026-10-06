const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  const browser = await chromium.launch({ args: ['--no-sandbox'], ...(proxy ? { proxy: { server: proxy } } : {}) });
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
      const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const base = process.env.TEST_APP_URL || 'http://localhost:8766/';
      if (!process.env.TEST_APP_URL) {
        await page.route(base + '**', route => {
          const pathname = new URL(route.request().url()).pathname;
          const file = path.join(__dirname, '..', pathname === '/' ? 'index.html' : pathname);
          return route.fulfill({ path: file, contentType: pathname.endsWith('.js') ? 'application/javascript' : 'text/html' });
        });
      }
      await page.goto(base);
      await page.waitForFunction(() => typeof show === 'function');
      const nav = viewport.width > 700 ? '.side nav' : '#mobileNav';
      async function navButton(view) {
        const direct = page.locator(`${nav} [data-view="${view}"]`);
        if (await direct.count()) return direct;
        if (!await page.locator('#menuDialog').isVisible()) await page.locator('#moreNav').click();
        return page.locator(`#menuDialog [data-view="${view}"]`);
      }
      async function navigate(view) { await (await navButton(view)).click(); }
      if (viewport.width <= 700) {
        await page.locator('#moreNav').click();
        assert.equal(await page.locator('#moreNav').getAttribute('aria-expanded'), 'true');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#menuDialog').isVisible(), false);
        await page.waitForFunction(() => document.getElementById('moreNav').getAttribute('aria-expanded') === 'false');
        assert.equal(await page.locator('#moreNav').evaluate(e => e === document.activeElement), true);
      }
      for (const view of ['trade', 'trades', 'calendar', 'stats', 'daily', 'accounts', 'settings', 'dashboard']) {
        await navigate(view);
        assert.equal(await page.locator('.view.active').getAttribute('id'), view);
        const selected = page.locator(`${viewport.width > 700 ? '.side nav' : '#menuDialog nav'} [data-view="${view}"]`);
        assert.equal(await selected.getAttribute('aria-current'), 'page');
        assert.match(await selected.getAttribute('class'), /active/);
        assert.equal(await page.locator('#menuDialog').isVisible(), false);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${view} has no page overflow`);
      }
      await page.evaluate(() => { window.auditDashboardRenders = 0; const original = renderDash; renderDash = () => { window.auditDashboardRenders++; original(); }; });
      await navigate('stats');
      assert.equal(await page.evaluate(() => window.auditDashboardRenders), 0, 'navigation only renders its destination');
      const settings = await navButton('settings');
      await settings.focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.view.active').getAttribute('id'), 'settings');
      assert.equal(await page.locator('#syncIndicator').isVisible(), false, 'settings shows only one sync badge');
      assert.equal(await page.locator('#profileName').getAttribute('id'), await page.locator('label[for="profileName"]').getAttribute('for'));
      page.on('dialog', async dialog => { throw new Error('Unexpected native browser dialog: ' + dialog.message()); });
      await navigate('accounts');
      await page.getByRole('button', { name: '+ Konto', exact: true }).click();
      assert.equal(await page.locator('#accountDialog').isVisible(), true);
      assert.equal(await page.locator('#accountName').evaluate(e => e === document.activeElement), true);
      await page.fill('#accountName', 'Cancelled account');
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => data.accounts.length), 0);
      await page.getByRole('button', { name: '+ Konto', exact: true }).click();
      await page.fill('#accountName', 'Browser test account');
      await page.fill('#accountBroker', 'Test broker');
      await page.selectOption('#accountType', 'Demo');
      await page.fill('#accountSize', '-1');
      await page.getByRole('button', { name: 'Konto speichern', exact: true }).click();
      assert.equal(await page.evaluate(() => data.accounts.length), 0, 'invalid account is not saved');
      await page.fill('#accountSize', '50000');
      await page.getByRole('button', { name: 'Konto speichern', exact: true }).click();
      await page.waitForFunction(() => data.accounts.length === 1);
      assert.match(await page.locator('#toastStack').innerText(), /Konto angelegt/);
      await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
      await page.fill('#accountDaily', '500');
      await page.getByRole('button', { name: 'Konto speichern', exact: true }).click();
      assert.equal(await page.evaluate(() => data.accounts[0].daily), 500);
      await navigate('trade');
      await page.selectOption('#accT', { label: 'Browser test account' });
      await page.fill('#pnl', '250');
      await page.getByRole('button', { name: 'Trade speichern', exact: true }).click();
      await page.waitForFunction(() => data.trades.length === 1);
      assert.match(await page.locator('#toastStack').innerText(), /Trade gespeichert/);
      await navigate('trades');
      assert.match(await page.locator('#tradeTable').innerText(), /250/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'populated trade table stays inside page');
      await navigate('dashboard');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'populated dashboard stays inside page');
      await navigate('calendar');
      const month = await page.locator('#calTitle').innerText();
      await page.getByRole('button', { name: 'Nächster Monat', exact: true }).click();
      assert.notEqual(await page.locator('#calTitle').innerText(), month);
      await page.reload();
      await page.waitForFunction(() => typeof show === 'function');
      await navigate('trades');
      assert.match(await page.locator('#tradeTable').innerText(), /250/);
      await page.getByRole('button', { name: 'Löschen', exact: true }).click();
      assert.equal(await page.locator('#confirmDialog').isVisible(), true);
      await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
      assert.equal(await page.evaluate(() => data.trades.length), 1, 'cancelling keeps the trade');
      await page.getByRole('button', { name: 'Löschen', exact: true }).click();
      await page.locator('#confirmAccept').click();
      await page.waitForFunction(() => data.trades.length === 0);
      assert.match(await page.locator('#toastStack').innerText(), /Trade gelöscht/);
      const backup = await page.evaluate(() => JSON.stringify({...data, daily: {'2026-10-06': 'Restored reflection'}}));
      await navigate('settings');
      await page.locator('#import').setInputFiles({name: 'test-backup.json', mimeType: 'application/json', buffer: Buffer.from(backup)});
      await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
      assert.equal(await page.evaluate(() => data.daily['2026-10-06']), undefined);
      await page.locator('#import').setInputFiles({name: 'test-backup.json', mimeType: 'application/json', buffer: Buffer.from(backup)});
      await page.locator('#confirmAccept').click();
      await page.waitForFunction(() => data.daily['2026-10-06'] === 'Restored reflection');
      assert.deepEqual(errors, []);
      console.log(`PASS ${viewport.width}px: all navigation clicks, active menu, keyboard, account creation, trade submission, calendar and reload`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
