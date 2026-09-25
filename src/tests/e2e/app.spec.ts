import tonejsMidi from '@tonejs/midi';
import { expect, test, type Page } from '@playwright/test';

const { Midi } = tonejsMidi;

/** Collects console errors and uncaught exceptions; every test ends by asserting there were none. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function freshStart(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('piece-title')).toContainText('Clair de lune');
}

test('loads the bundled piece with a clear starting point', async ({ page }) => {
  const errors = watchConsole(page);
  await freshStart(page);
  await expect(page.getByTestId('piece-title')).toContainText('Claude Debussy');
  await expect(page.getByTestId('position')).toContainText('Bar 1/72');
  await expect(page.getByTestId('part')).toHaveValue('right');
  await expect(page.getByTestId('tempo')).toHaveValue('60');
  await expect(page.getByTestId('clear-loop')).toContainText('bars 1–4');
  await expect(page.getByRole('region', { name: 'Welcome' })).toBeVisible();
  await expect(page.getByTestId('piano-roll')).toHaveAttribute('aria-label', /Next notes: F5, A♭5, bar 1/);
  expect(errors).toEqual([]);
});

test('manual mode: Space advances and is recorded as manual', async ({ page }) => {
  const errors = watchConsole(page);
  await freshStart(page);
  await page.getByRole('button', { name: 'Try without a microphone' }).click();
  await expect(page.getByRole('radio', { name: 'Manual' })).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('play').click();
  await expect(page.getByTestId('status')).toContainText('press Space for F5 + A♭5', { timeout: 5000 });
  await page.keyboard.press('Space');
  await expect(page.getByTestId('count-manual')).toHaveText('1');
  await expect(page.getByTestId('count-recognized')).toHaveText('0');
  expect(errors).toEqual([]);
});

test('learn mode with a fake microphone playing a recorded piano chord', async ({ page }) => {
  const errors = watchConsole(page);
  await freshStart(page);
  await page.getByTestId('welcome-setup').click();
  await page.getByTestId('enable-mic').click();
  await expect(page.getByTestId('input-details')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('input-details')).toContainText('requested off');
  await page.getByRole('button', { name: 'Skip setup' }).click();
  await expect(page.getByTestId('mic-pill')).not.toContainText('Mic off');
  await page.getByTestId('play').click();
  // The chord in the fake input repeats every 6 s; the first gate must be recognized from it.
  await expect(page.getByTestId('count-recognized')).toHaveText('1', { timeout: 20_000 });
  // The next chord (D♭5 + F5) is not in the input: the engine must wait, having heard only F5 at most.
  await expect(page.getByTestId('status')).toContainText(/D♭5/, { timeout: 10_000 });
  await page.waitForTimeout(7000);
  await expect(page.getByTestId('count-recognized')).toHaveText('1');
  await expect(page.getByTestId('status')).toContainText(/waiting for D♭5|Waiting for D♭5/);
  expect(errors).toEqual([]);
});

test('controls: tempo, mode, part, loop, seek, and saved settings', async ({ page }) => {
  const errors = watchConsole(page);
  await freshStart(page);
  await page.getByRole('button', { name: 'Try without a microphone' }).click();
  await page.getByTestId('tempo').fill('80');
  await expect(page.getByText('80%')).toBeVisible();
  await page.getByTestId('part').selectOption('both');
  await page.getByRole('radio', { name: 'Listen' }).click();
  await expect(page.getByTestId('status')).toContainText('Ready to play the piece');
  await page.getByTestId('clear-loop').click();
  await expect(page.getByTestId('clear-loop')).toHaveCount(0);
  await page.locator('body').press('ArrowRight');
  await page.locator('body').press('ArrowRight');
  await expect(page.getByTestId('position')).toContainText('Bar 3/72');
  await page.getByLabel('Loop from bar').fill('5');
  await page.getByLabel('Loop to bar').fill('8');
  await page.getByRole('button', { name: 'Set', exact: true }).click();
  await expect(page.getByTestId('clear-loop')).toContainText('bars 5–8');
  await expect(page.getByTestId('position')).toContainText('Bar 5/72');
  await page.reload();
  await expect(page.getByTestId('tempo')).toHaveValue('80');
  await expect(page.getByTestId('part')).toHaveValue('both');
  await expect(page.getByRole('radio', { name: 'Listen' })).toHaveAttribute('aria-checked', 'true');
  expect(errors).toEqual([]);
});

test('hear passage pauses matching and returns after the sound fades', async ({ page }) => {
  const errors = watchConsole(page);
  await freshStart(page);
  await page.getByRole('button', { name: 'Try without a microphone' }).click();
  await page.getByRole('button', { name: 'Hear passage' }).click();
  await expect(page.getByTestId('status')).toContainText('Playing the passage', { timeout: 10_000 });
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByTestId('status')).not.toContainText(/Playing the passage|fade/, { timeout: 8000 });
  expect(errors).toEqual([]);
});

test('imports a MIDI file and rejects a broken one', async ({ page }) => {
  const errors = watchConsole(page);
  await freshStart(page);
  const midi = new Midi();
  const tr = midi.addTrack();
  tr.name = 'Melody';
  [60, 62, 64, 65, 67].forEach((p, i) => tr.addNote({ midi: p, time: i * 0.5, duration: 0.45, velocity: 0.8 }));
  await page.getByTestId('midi-input').setInputFiles({ name: 'scale.mid', mimeType: 'audio/midi', buffer: Buffer.from(midi.toArray()) });
  await expect(page.getByTestId('piece-title')).toContainText('scale');
  await expect(page.getByRole('alert')).toContainText('5 notes');
  // No hand mapping for an imported file: the part falls back to both hands, hand options are disabled.
  await expect(page.getByTestId('part')).toHaveValue('both');
  await page.getByTestId('midi-input').setInputFiles({ name: 'broken.mid', mimeType: 'audio/midi', buffer: Buffer.from('not a midi file at all') });
  await expect(page.getByRole('alert')).toContainText('Could not import “broken.mid”');
  await expect(page.getByTestId('piece-title')).toContainText('scale');
  expect(errors).toEqual([]);
});

test('missing bundled song shows how to fetch it', async ({ page }) => {
  await page.route('**/songs/clair-de-lune.mid', (r) => r.fulfill({ status: 404, body: '' }));
  await page.goto('/');
  await expect(page.getByTestId('song-missing')).toContainText('npm run fetch:song');
});

test('keyboard shortcuts list and dialogs are reachable', async ({ page }) => {
  const errors = watchConsole(page);
  await freshStart(page);
  await page.locator('body').press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect(page.getByLabel('Accompaniment: play the other part while I practise')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
  await expect(page.getByTestId('diag-state')).toHaveText('ready');
  expect(errors).toEqual([]);
});
