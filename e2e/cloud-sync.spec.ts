import { expect, test } from '@playwright/test';

const backend = 'https://ruefkvkavvycposzahit.supabase.co';
const userId = '11111111-1111-4111-8111-111111111111';

test('manual account sync restores only favourites and recent tools without PDF transfer', async ({ page }) => {
  const requests: { method: string; url: string; body: string | null }[] = [];
  let stored: { favorite_tools: string[]; recent_tools: string[] } | null = null;

  await page.route(backend + '/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'apikey, authorization, content-type, prefer',
      'content-type': 'application/json'
    };
    requests.push({ method, url: request.url(), body: request.postData() });
    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
    } else if (url.pathname === '/auth/v1/token') {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
        user: { id: userId, email: 'test@example.com' }
      }) });
    } else if (url.pathname === '/rest/v1/docflow_preferences' && method === 'POST') {
      expect(request.headers().prefer).toContain('resolution=merge-duplicates');
      expect(request.headers().authorization).toBe('Bearer mock-access-token');
      const body = request.postDataJSON() as Record<string, unknown>;
      expect(body.user_id).toBe(userId);
      expect(Object.keys(body).sort()).toEqual(['favorite_tools', 'recent_tools', 'updated_at', 'user_id']);
      stored = { favorite_tools: body.favorite_tools as string[], recent_tools: body.recent_tools as string[] };
      await route.fulfill({ status: 204, headers });
    } else if (url.pathname === '/rest/v1/docflow_preferences' && method === 'GET') {
      await route.fulfill({ status: 200, headers, body: JSON.stringify(stored ? [stored] : []) });
    } else if (url.pathname === '/auth/v1/logout') {
      await route.fulfill({ status: 204, headers });
    } else {
      await route.fulfill({ status: 404, headers, body: '{}' });
    }
  });

  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.locator('[data-favorite="merge"]').click();
  await expect(page.locator('[data-favorite="merge"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('.topbar-actions [data-action="cloud"]').click();
  const dialog = page.locator('#info-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Not signed in')).toBeVisible();
  await dialog.getByLabel('Cloud account email').fill('test@example.com');
  await dialog.getByLabel('Cloud account password').fill('example-password-123');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog.getByText('Signed in as test@example.com')).toBeVisible();

  await dialog.getByRole('button', { name: 'Save preferences to cloud' }).click();
  await expect(dialog.getByText('Preferences saved to your private DocFlow project.')).toBeVisible();
  expect(stored).toEqual(expect.objectContaining({ favorite_tools: expect.arrayContaining(['merge']) }));

  await dialog.getByRole('button', { name: 'Close' }).click();
  await page.locator('[data-favorite="merge"]').click();
  await expect(page.locator('[data-favorite="merge"]')).toHaveAttribute('aria-pressed', 'false');

  await page.locator('.topbar-actions [data-action="cloud"]').click();
  await dialog.getByRole('button', { name: 'Restore cloud preferences' }).click();
  await expect(dialog.getByText('Cloud favorites and recent tools restored on this device.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('[data-favorite="merge"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('.topbar-actions [data-action="cloud"]').click();
  await dialog.getByRole('button', { name: 'Sign out' }).click();
  await expect(dialog.getByText('Not signed in')).toBeVisible();

  const applicationPayloads = requests.filter((x) => x.url.includes('/rest/v1/') && x.body);
  expect(applicationPayloads).toHaveLength(1);
  const serialized = JSON.stringify(applicationPayloads);
  expect(serialized).not.toContain('example-password-123');
  expect(serialized).not.toContain('PDF-');
  expect(serialized).not.toContain('filename');
});

test('cloud preferences remain discoverable on mobile without requiring sign-in', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 820 });
  await page.goto('/zubaer-ahmed-PDF-TEST/');
  await page.locator('.topbar-actions [data-action="cloud"]').click();
  await expect(page.locator('#info-dialog')).toBeVisible();
  await expect(page.locator('#info-dialog').getByText('Keep working locally without signing in.')).toBeVisible();
  await page.locator('#info-dialog').getByRole('button', { name: 'Close' }).click();
  await page.locator('[data-open-tool="rotate"]').first().click();
  await expect(page.getByRole('dialog', { name: 'Workspace' })).toBeVisible();
});

test('email-confirmation callback validates identity and removes URL tokens', async ({ page }) => {
  const requested: string[] = [];
  await page.route(backend + '/**', async (route) => {
    requested.push(route.request().url());
    const headers = {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'authorization, apikey'
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
    } else {
      await route.fulfill({
        status: 200, headers,
        body: JSON.stringify({ id: userId, email: 'confirmed@example.com' })
      });
    }
  });
  await page.goto('/zubaer-ahmed-PDF-TEST/#access_token=temporary-test-token&refresh_token=temporary-refresh&expires_in=3600&type=signup');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('docflow.cloud-session.v1'))).toContain('confirmed@example.com');
  expect(requested.some((url) => url.includes('/auth/v1/user'))).toBe(true);
  await page.locator('.topbar-actions [data-action="cloud"]').click();
  await expect(page.locator('#info-dialog').getByText('Signed in as confirmed@example.com')).toBeVisible();
});
