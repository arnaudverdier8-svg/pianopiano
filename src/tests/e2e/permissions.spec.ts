import { expect, test } from '@playwright/test';

test('a denied microphone is explained, and manual practice still works', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('welcome-setup').click();
  await page.getByTestId('enable-mic').click();
  await expect(page.getByTestId('mic-error')).toContainText(/denied|not allowed/i, { timeout: 10_000 });
  await expect(page.getByTestId('mic-error')).toContainText(/allow the microphone|Open the app/);
  await page.getByRole('button', { name: 'Skip setup' }).click();
  await expect(page.getByTestId('mic-pill')).toContainText('Mic unavailable');
  await page.getByRole('radio', { name: 'Manual' }).click();
  await page.getByTestId('play').click();
  await expect(page.getByTestId('status')).toContainText('press Space', { timeout: 5000 });
});
