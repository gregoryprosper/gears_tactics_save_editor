import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, copyFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from '../src/save-format';
const temporary = await mkdtemp(join(tmpdir(), 'gears-electron-smoke-'));
const source = join(temporary, 'geargamesavegame_slot_39');
await copyFile('sample_save_files/END GAME -  Jacked/geargamesavegame_slot_39', source);
const original = await readFile(source);
await mkdir('artifacts', { recursive: true });
const app = await electron.launch({
  args: [resolve('out/main/index.js'), '--inspect', source],
  env: { ...process.env, GTSE_TEST_DATA: join(temporary, 'preferences') },
  timeout: 30000,
});
const errors: string[] = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(page.getByRole('heading', { name: 'Campaign overview' })).toBeVisible();
  await expect(page.getByText('READ ONLY', { exact: true })).toBeVisible();
  await expect(page.getByText('1,391', { exact: true })).toBeVisible();
  const rendererProcesses = await app.evaluate(({ app }) =>
    app
      .getAppMetrics()
      .filter((p) => p.type === 'Tab')
      .map((p) => ({ sandboxed: p.sandboxed })),
  );
  expect(rendererProcesses.length).toBeGreaterThan(0);
  expect(rendererProcesses.every((p) => p.sandboxed === true)).toBe(true);
  expect(
    await page.evaluate(() => ({
      node: typeof (window as unknown as { require?: unknown }).require,
      api: typeof window.editor?.open,
    })),
  ).toEqual({ node: 'undefined', api: 'function' });
  await page.screenshot({ path: 'artifacts/overview.png' });
  await page.getByRole('button', { name: 'Soldiers 17' }).click();
  await expect(page.getByRole('heading', { name: 'Gabe Diaz' })).toBeVisible();
  await page.getByRole('tab', { name: /^Skills/ }).click();
  await expect(page.getByRole('heading', { name: 'Stim III', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Empty slot', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/skills.png' });
  await page.getByLabel('Search soldiers').fill('Mikayla');
  await page.getByRole('button', { name: /Mikayla Dorn Sniper/ }).click();
  await expect(page.getByRole('tab', { name: 'Skills 35' })).toBeVisible();
  await expect(page.getByText('35 / 35 nodes learned', { exact: true })).toBeVisible();
  await expect(page.getByText('ALL SKILLS UNLOCKED', { exact: true })).toBeVisible();
  await expect(page.locator('.learned-skill')).toHaveCount(35);
  await expect(page.locator('.learned-skill').filter({ hasText: 'Lucky Streak' })).toBeVisible();
  await expect(page.locator('.skill-card')).toHaveCount(7);
  await expect(page.getByRole('heading', { name: 'Active abilities', exact: true })).toBeVisible();
  await expect(
    page.locator('.skill-card code, .skill-card small, .skill-card .slot-number'),
  ).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Empty slot', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/mikayla-learned-skills.png' });
  await page.getByLabel('Search soldiers').fill('Jack');
  await page.getByRole('button', { name: /Jack Jack · Level/ }).click();
  await expect(page.getByRole('tab', { name: 'Skills 28' })).toBeVisible();
  await expect(page.locator('.skill-card')).toHaveCount(21);
  await expect(page.locator('.learned-skill')).toHaveCount(28);
  await page.getByLabel('Search soldiers').fill('Gabe');
  await page.getByRole('button', { name: /Gabe Diaz Support/ }).click();
  await page.getByRole('tab', { name: 'Stats', exact: true }).click();
  await page.getByRole('button', { name: 'Enable editing' }).click();
  await page.getByRole('spinbutton', { name: 'Ability points', exact: true }).fill('20');
  await expect(page.getByText('UNSAVED CHANGES', { exact: true })).toBeVisible();
  expect(await readFile(source)).toEqual(original);
  await page.getByRole('button', { name: /Apply changes/ }).click();
  await expect(page.getByRole('dialog', { name: 'Pending changes' })).toBeVisible();
  await expect(page.locator('.patch-values b')).toHaveText('20');
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Ability points', exact: true })).toHaveValue(
    '0',
  );
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Ability points', exact: true })).toHaveValue(
    '20',
  );
  await page.screenshot({ path: 'artifacts/soldiers.png' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Save 1 changes', exact: true }).click();
  await expect(page.getByText(/Save verified and written/)).toBeVisible();
  expect(await readFile(source + '.bak')).toEqual(original);
  expect(
    parse(await readFile(source)).characters.find((c) => c.hero === 'Gabriel')?.stats
      .CurrentAbilityPoints,
  ).toBe(20);
  // A draft belongs to its character even after selecting someone else before Apply/Save.
  const beforeSniperEdit = await readFile(source);
  const beforeSniperSave = parse(beforeSniperEdit);
  const sniper = beforeSniperSave.characters.find((c) => c.hero === 'Mikayla')!;
  const sniperHealth = beforeSniperSave.objects[sniper.objectIndex]!.properties.find(
    (p) => p.name === 'Health',
  )!;
  const nextHealth = (sniperHealth.value as number) + 1;
  await page.getByLabel('Search soldiers').fill('Mikayla');
  await page.getByRole('button', { name: /Mikayla Dorn Sniper/ }).click();
  await expect(page.getByRole('heading', { name: 'Mikayla Dorn' })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Actions', exact: true })).toHaveCount(0);
  await page.getByRole('spinbutton', { name: 'Health', exact: true }).fill(String(nextHealth));
  await page.getByLabel('Search soldiers').fill('Gabe');
  await page.getByRole('button', { name: /Gabe Diaz Support/ }).click();
  await expect(page.getByRole('spinbutton', { name: 'Actions', exact: true })).toHaveCount(0);
  await expect(page.getByRole('spinbutton', { name: 'Health', exact: true })).toHaveValue(
    String(beforeSniperSave.characters.find((c) => c.hero === 'Gabriel')!.stats.Health),
  );
  await page.getByRole('button', { name: /Apply changes/ }).click();
  await expect(page.locator('.patch strong')).toHaveText('Mikayla Dorn · Health');
  await page.getByRole('button', { name: 'Save 1 changes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Pending changes' })).not.toBeVisible();
  const afterSniperEdit = await readFile(source);
  const expectedSniperEdit = Buffer.from(beforeSniperEdit);
  expectedSniperEdit.writeInt32LE(nextHealth, sniperHealth.valueOffset);
  expect(afterSniperEdit).toEqual(expectedSniperEdit);
  expect(await readFile(source + '.bak.1')).toEqual(beforeSniperEdit);
  const afterSniperSave = parse(afterSniperEdit);
  expect(afterSniperSave.characters.find((c) => c.hero === 'Mikayla')?.stats.Health).toBe(
    nextHealth,
  );
  expect(afterSniperSave.characters.find((c) => c.hero === 'Mikayla')?.stats.ActionPoints).toBe(3);
  expect(afterSniperSave.characters.find((c) => c.hero === 'Gabriel')?.stats.ActionPoints).toBe(3);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Developer mode', exact: true }).check();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.getByRole('tab', { name: /^Skills/ }).click();
  await expect(page.locator('.skill-card')).toHaveCount(10);
  await expect(page.getByRole('heading', { name: 'Empty slot', exact: true })).toHaveCount(2);
  await expect(page.locator('.skill-card code')).toHaveCount(10);
  await expect(page.locator('.skill-card .slot-number')).toHaveCount(10);

  await page.getByRole('button', { name: 'Raw Inspector DEV' }).click();
  await page
    .getByRole('textbox', { name: 'Search objects, properties, or strings' })
    .fill('GanderCharacterData_0');
  await page
    .locator('.object-list button')
    .filter({ hasText: 'GanderCharacterData_0' })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: 'GanderCharacterData_0', exact: true }),
  ).toBeVisible();
  await expect(page.locator('td strong').filter({ hasText: 'CurrentAbilityPoints' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/inspector.png' });
  // Native-dialog paths exercise the same IPC entry points without interacting with real files.
  const copy = join(temporary, 'save-as-copy');
  await app.evaluate(({ dialog }, destination) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
  }, copy);
  await page.getByRole('button', { name: 'Save as…', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('save-as-copy');
  expect(await readFile(copy)).toEqual(await readFile(source));
  const invalid = resolve('sample_save_files/NEW GAME - Classic Mode/geargamesavegame_slot_1');
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, invalid);
  await page.getByRole('button', { name: 'Open save', exact: true }).click();
  await expect(page.getByText(/Saving has been disabled because/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enable editing', exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
  console.log(
    'Electron smoke passed: renderer isolation, actual fixture UI, skill counts, editing, undo/redo, character switching preserves draft ownership, backups, atomic write, Save As, developer inspector and unsafe-file gate.',
  );
} finally {
  await app.close();
  await rm(temporary, { recursive: true, force: true });
}
