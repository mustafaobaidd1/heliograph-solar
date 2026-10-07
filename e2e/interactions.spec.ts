import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/** A fixed, daytime view so tests do not depend on the clock (no intro animation either). */
const FIXED = '?place=amman&date=2026-06-21&time=1000&tilt=30&az=180';

async function open(page: Page, query = FIXED): Promise<void> {
  await page.goto(`./${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
}

async function waitForOptimum(page: Page): Promise<number> {
  const energy = page.getByTestId('optimum-energy');
  await expect(energy).toBeVisible({ timeout: 30_000 });
  return Number((await energy.innerText()).replace(/[^\d.]/g, ''));
}

async function numberIn(locator: Locator): Promise<number> {
  return Number((await locator.innerText()).replace(/[^\d.−-]/g, '').replace('−', '-'));
}

test('changing the place updates the sun path and the sunrise', async ({ page }) => {
  await open(page);
  const path = page.locator('.sp-selected path').first();
  const before = await path.getAttribute('d');
  const sunrise = page.locator('.facts div', { hasText: 'Sunrise' }).locator('dd');
  await expect(sunrise).toHaveText('05:31');

  await page.getByRole('button', { name: 'Toronto', exact: true }).click();
  await expect(page.locator('.place__current strong')).toHaveText('Toronto');
  await expect(sunrise).not.toHaveText('05:31');
  await expect.poll(() => path.getAttribute('d')).not.toBe(before);
  await expect(page).toHaveURL(/place=toronto/);
});

test('dragging the time scrubber moves the sun and changes the readout', async ({ page }) => {
  await open(page);
  const poa = page.getByTestId('poa-now');
  const before = await poa.innerText();
  const slider = page.getByLabel('Time of day (local clock)');
  const box = (await slider.boundingBox())!;
  // Drag from 10:00 towards 15:00 along the track.
  await page.mouse.move(box.x + box.width * (600 / 1439), box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * (900 / 1439), box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(poa).not.toHaveText(before);
  await expect(page.locator('.timebar__time')).not.toHaveText('10:00');
});

test('arrow keys step the time scrubber', async ({ page }) => {
  await open(page);
  const slider = page.getByLabel('Time of day (local clock)');
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.timebar__time')).toHaveText('10:05');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('.timebar__time')).toHaveText('11:05');
});

test('the optimiser maps the landscape and refines the optimum', async ({ page }) => {
  await open(page);
  const year = await waitForOptimum(page);
  await expect(page.getByTestId('optimum-marker')).toBeVisible();
  expect(year).toBeGreaterThan(2000);
  // The heat-map canvas has real pixels.
  const painted = await page.locator('.heat__canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const colours = new Set<number>();
    for (let i = 0; i < d.length; i += 4 * 7)
      colours.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    return colours.size;
  });
  expect(painted).toBeGreaterThan(20);
  // A shorter period gives less energy and a different optimum.
  await page.getByRole('radio', { name: 'Summer' }).check();
  await expect
    .poll(
      async () =>
        Number((await page.getByTestId('optimum-energy').innerText()).replace(/[^\d.]/g, '')),
      { timeout: 30_000 },
    )
    .toBeLessThan(year * 0.5);
});

test('using the optimum moves the panel there', async ({ page }) => {
  await open(page, '?place=amman&date=2026-06-21&time=1000&tilt=70&az=90');
  await waitForOptimum(page);
  await page.getByRole('button', { name: 'Use optimum' }).click();
  const tilt = page.locator('.slider', { hasText: 'Tilt' }).locator('.slider__value');
  await expect.poll(async () => numberIn(tilt)).toBeGreaterThan(25);
  await expect.poll(async () => numberIn(tilt)).toBeLessThan(38);
  await expect(page.locator('.panel__pct strong')).toHaveText(/^100(\.0)?%$/);
});

test('drawing a skyline on the sun-path diagram causes a shading loss', async ({ page }) => {
  await open(page);
  await waitForOptimum(page);
  const loss = page.getByTestId('shading-loss');
  await expect(loss).toHaveText('0.0 %');
  await page.getByRole('button', { name: 'Draw skyline' }).click();
  const svg = page.locator('.sunpath__svg');
  await svg.scrollIntoViewIfNeeded();
  const box = (await svg.boundingBox())!;
  const at = (az: number, el: number) => {
    const r = 228 * Math.tan(((90 - el) / 2) * (Math.PI / 180));
    return {
      x: box.x + ((280 + r * Math.sin((az * Math.PI) / 180)) / 560) * box.width,
      y: box.y + ((280 - r * Math.cos((az * Math.PI) / 180)) / 560) * box.height,
    };
  };
  // A tall building from south-east to south-west, 40° high.
  const start = at(120, 40);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let az = 125; az <= 240; az += 5) {
    const p = at(az, 40);
    await page.mouse.move(p.x, p.y);
  }
  await page.mouse.up();
  await expect(page.locator('.sp-skyline')).toBeVisible();
  await expect.poll(async () => numberIn(loss), { timeout: 30_000 }).toBeGreaterThan(1);
  // The 3D scene and the URL carry the skyline too.
  await expect(page).toHaveURL(/sky=/);
});

test('the keyboard skyline table adds points and they shade the panel', async ({ page }) => {
  await open(page);
  await waitForOptimum(page);
  await page.getByText('Edit points with the keyboard').click();
  const add = async (az: string, el: string) => {
    await page.getByLabel('Azimuth °').fill(az);
    await page.getByLabel('Elevation °').fill(el);
    await page.getByRole('button', { name: 'Add point' }).click();
  };
  await add('120', '0');
  await add('121', '50');
  await add('239', '50');
  await add('240', '0');
  await expect(page.getByRole('button', { name: /Remove point/ })).toHaveCount(4);
  await expect
    .poll(async () => numberIn(page.getByTestId('shading-loss')), { timeout: 30_000 })
    .toBeGreaterThan(1);
  // Invalid input is explained.
  await page.getByLabel('Azimuth °').fill('400');
  await page.getByLabel('Elevation °').fill('10');
  await page.getByRole('button', { name: 'Add point' }).click();
  await expect(page.getByRole('alert')).toContainText('Azimuth must be');
});

test('polar day is detected and explained', async ({ page }) => {
  await open(page, '?place=tromso&date=2026-06-21&time=0030');
  await expect(page.locator('.note--polar')).toContainText('Midnight sun');
  await expect(page.locator('.facts div', { hasText: 'Day length' }).locator('dd')).toHaveText(
    '24 h 00 min',
  );
  // The Sun is still up at half past midnight.
  await expect(page.locator('.sunchip')).toContainText('up');
});

test('polar night is detected and explained', async ({ page }) => {
  await open(page, '?place=tromso&date=2026-12-21&time=1200');
  await expect(page.locator('.note--polar')).toContainText('Polar night');
  await expect(page.locator('.sunchip')).toContainText('below the horizon');
});

test('invalid coordinates are explained and the place is kept', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Enter coordinates' }).click();
  await page.getByLabel('Latitude °').fill('123');
  await page.getByLabel('Longitude °').fill('east');
  await page.getByRole('button', { name: 'Go there' }).click();
  await expect(page.getByText('Latitude must be between −90° and 90°')).toBeVisible();
  await expect(page.getByText('Enter a longitude in degrees')).toBeVisible();
  await expect(page.locator('.place__current strong')).toHaveText('Amman');
  // Valid input moves there and estimates the zone from longitude.
  await page.getByLabel('Latitude °').fill('-23.55');
  await page.getByLabel('Longitude °').fill('-46.63');
  await page.getByLabel('Time zone (IANA)').fill('');
  await page.getByRole('button', { name: 'Go there' }).click();
  await expect(page.locator('.place__current strong')).toHaveText('Custom location');
  await expect(page.locator('.place__meta')).toContainText('23.55° S');
});

test.describe('geolocation', () => {
  test('denied permission keeps the current place with a message', async ({ page, context }) => {
    await context.clearPermissions();
    await open(page);
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.locator('.note--warn')).toContainText(/denied|unavailable|too long/);
    await expect(page.locator('.place__current strong')).toHaveText('Amman');
  });

  test('granted permission moves to the device position', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 48.8566, longitude: 2.3522 });
    await open(page);
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.locator('.place__current strong')).toHaveText('My location');
    await expect(page.locator('.place__meta')).toContainText('48.86° N');
  });
});

test.describe('long-term averages', () => {
  test('preset cities use bundled NASA POWER normals', async ({ page }) => {
    await open(page);
    const total = page.getByTestId('day-total');
    const clear = await numberIn(total);
    await page.getByRole('radio', { name: 'Long-term average' }).check();
    await expect(page.locator('.status')).toContainText('bundled with the app');
    await expect.poll(async () => numberIn(total)).toBeLessThan(clear);
  });

  test('a custom place falls back to clear sky when NASA POWER is unreachable', async ({
    page,
  }) => {
    await page.route('**/power.larc.nasa.gov/**', (route) => route.abort());
    await open(page, '?lat=10&lon=10&tz=Africa/Lagos&date=2026-06-21&time=1000&src=climate');
    await expect(page.locator('.status--warn')).toContainText('Long-term averages unavailable');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    // Clear-sky numbers are still on screen.
    expect(await numberIn(page.getByTestId('poa-now'))).toBeGreaterThan(100);
  });

  test('a custom place loads live normals when NASA POWER answers', async ({ page }) => {
    const months = [
      'JAN',
      'FEB',
      'MAR',
      'APR',
      'MAY',
      'JUN',
      'JUL',
      'AUG',
      'SEP',
      'OCT',
      'NOV',
      'DEC',
    ];
    const series = (v: number) => Object.fromEntries(months.map((m) => [m, v]));
    await page.route('**/power.larc.nasa.gov/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          properties: {
            parameter: {
              ALLSKY_SFC_SW_DWN: series(5),
              ALLSKY_SFC_SW_DNI: series(4),
              ALLSKY_SFC_SW_DIFF: series(2),
              CLRSKY_SFC_SW_DWN: series(6.5),
              T2M: series(24),
              T2M_RANGE: series(10),
            },
          },
        }),
      }),
    );
    await open(page, '?lat=10&lon=10&tz=Africa/Lagos&date=2026-06-21&time=1000&src=climate');
    await expect(page.locator('.status')).toContainText('fetched live');
  });
});

test('falls back to a 2D plan when WebGL is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    // Test shim: refuse WebGL contexts only, forward everything else.
    const original = HTMLCanvasElement.prototype.getContext as (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) => RenderingContext | null;
    const shim = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
      return original.call(this, type, ...args);
    };
    HTMLCanvasElement.prototype.getContext = shim as typeof HTMLCanvasElement.prototype.getContext;
  });
  await open(page);
  await expect(page.locator('.plan')).toBeVisible();
  await expect(page.locator('.scene__note')).toContainText('WebGL is not available');
  await expect(page.locator('.plan__shadow').first()).toBeAttached();
});

test('the URL restores a shared view', async ({ page }) => {
  await open(
    page,
    '?place=sydney&date=2026-12-21&time=0915&tilt=45&az=10&sky=80:0,81:20,120:20,121:0&tr=haydavies&kwp=7',
  );
  await expect(page.locator('.place__current strong')).toHaveText('Sydney');
  await expect(page.locator('.slider', { hasText: 'Tilt' }).locator('.slider__value')).toHaveText(
    '45.0°',
  );
  await expect(page.locator('.timebar__time')).toHaveText('09:15');
  await expect(page.getByRole('radio', { name: 'Hay–Davies 1980' })).toBeChecked();
  await expect(page.getByLabel('Array size')).toHaveValue('7');
  await expect(page.locator('.sp-skyline')).toBeVisible();
});

test('exports an hourly CSV for the whole year', async ({ page }) => {
  await open(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download hourly CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('heliograph_amman_2026_tilt30_az180.csv');
  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  expect(lines[0]).toContain('poa_total_w_m2');
  expect(lines.length).toBe(8761);
});

test('play the day steps by whole hours under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await page.getByRole('button', { name: 'Play the day' }).click();
  await expect(page.locator('.timebar__time')).toHaveText('11:00', { timeout: 5000 });
  await page.getByRole('button', { name: 'Pause the day' }).click();
  const t = await page.locator('.timebar__time').innerText();
  expect(t.endsWith(':00')).toBe(true);
});
