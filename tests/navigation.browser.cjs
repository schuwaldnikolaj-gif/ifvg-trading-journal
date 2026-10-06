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
      for (const view of ['trade', 'trades', 'calendar', 'stats', 'daily', 'accounts', 'settings', 'dashboard']) {
        await page.locator(`${nav} [data-view="${view}"]`).click();
        assert.equal(await page.locator('.view.active').getAttribute('id'), view);
        assert.equal(await page.locator(`${nav} .active`).getAttribute('data-view'), view);
        assert.equal(await page.locator(`${nav} .active`).getAttribute('aria-current'), 'page');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${view} has no page overflow`);
      }
      await page.evaluate(() => { window.auditDashboardRenders = 0; const original = renderDash; renderDash = () => { window.auditDashboardRenders++; original(); }; });
      await page.locator(`${nav} [data-view="stats"]`).click();
      assert.equal(await page.evaluate(() => window.auditDashboardRenders), 0, 'navigation only renders its destination');
      const settings = page.locator(`${nav} [data-view="settings"]`);
      await settings.focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.view.active').getAttribute('id'), 'settings');
      assert.equal(await page.locator('#syncIndicator').isVisible(), false, 'settings shows only one sync badge');
      assert.equal(await page.locator('#profileName').getAttribute('id'), await page.locator('label[for="profileName"]').getAttribute('for'));
      const prompts = ['Browser test account', 'Test broker', 'Demo', '50000'];
      page.on('dialog', async dialog => {
        if (dialog.type() === 'prompt') await dialog.accept(prompts.shift());
        else await dialog.accept();
      });
      await page.locator(`${nav} [data-view="accounts"]`).click();
      await page.getByRole('button', { name: '+ Konto', exact: true }).click();
      await page.waitForFunction(() => data.accounts.length === 1);
      await page.locator(`${nav} [data-view="trade"]`).click();
      await page.selectOption('#accT', { label: 'Browser test account' });
      await page.fill('#pnl', '250');
      await page.getByRole('button', { name: 'Trade speichern', exact: true }).click();
      await page.waitForFunction(() => data.trades.length === 1);
      await page.locator(`${nav} [data-view="trades"]`).click();
      assert.match(await page.locator('#tradeTable').innerText(), /250/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'populated trade table stays inside page');
      await page.locator(`${nav} [data-view="dashboard"]`).click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'populated dashboard stays inside page');
      await page.locator(`${nav} [data-view="calendar"]`).click();
      const month = await page.locator('#calTitle').innerText();
      await page.getByRole('button', { name: 'Nächster Monat', exact: true }).click();
      assert.notEqual(await page.locator('#calTitle').innerText(), month);
      await page.reload();
      await page.waitForFunction(() => typeof show === 'function');
      await page.locator(`${nav} [data-view="trades"]`).click();
      assert.match(await page.locator('#tradeTable').innerText(), /250/);
      assert.deepEqual(errors, []);
      console.log(`PASS ${viewport.width}px: all navigation clicks, active menu, keyboard, account creation, trade submission, calendar and reload`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
