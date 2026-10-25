import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const agentDir = path.resolve('.tmp/e2e/agent');

function drop(name: string, body: unknown) {
  const tmp = path.join(agentDir, 'inbox', `.${name}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(body));
  fs.renameSync(tmp, path.join(agentDir, 'inbox', name));
}

test('the app opens on Today; All projects has its own address', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('focus-row').first()).toBeVisible();
  await expect(page.getByTestId('week-strip').getByTestId('week-day')).toHaveCount(7);
  await expect(page.getByTestId('done-this-week')).toContainText('done since Monday');
  await page.getByRole('button', { name: 'All projects' }).click();
  await expect(page).toHaveURL(/#\/projects$/);
  await expect(page.getByTestId('project-card').first()).toBeVisible();
});

test('Board: drag a card to another column; Timeline shows dated tasks', async ({ page }) => {
  await page.goto('/#/projects');
  await page.getByTestId('project-card').filter({ hasText: 'Black Buddha FM' }).click();

  await page.locator('.tabs button', { hasText: 'Board' }).click();
  const card = page.getByTestId('board-card').filter({ hasText: 'Pick the theme (Ep 5)' });
  await expect(page.getByTestId('board-col-not_started').getByTestId('board-card').filter({ hasText: 'Pick the theme (Ep 5)' })).toBeVisible();
  await card.dragTo(page.getByTestId('board-col-in_progress'));
  await expect(page.getByTestId('board-col-in_progress').getByTestId('board-card').filter({ hasText: 'Pick the theme (Ep 5)' })).toBeVisible();
  await expect(page.getByText(/Moved “Pick the theme \(Ep 5\)” to In progress/)).toBeVisible();

  // Undo from the toast puts it back.
  await page.locator('.toast').filter({ hasText: 'Pick the theme' }).getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('board-col-not_started').getByTestId('board-card').filter({ hasText: 'Pick the theme (Ep 5)' })).toBeVisible();

  await page.locator('.tabs button', { hasText: 'Timeline' }).click();
  await expect(page.getByTestId('timeline')).toBeVisible();
  await expect(page.getByTestId('tl-task').filter({ hasText: 'Pick the theme (Ep 5)' })).toBeVisible();
  await page.getByTestId('tl-task').filter({ hasText: 'Pick the theme (Ep 5)' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('create a task, drop an agent file, resolve a conflict, apply, undo', async ({ page, context, request }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/#/projects');
  await page.getByTestId('project-card').filter({ hasText: 'Black Buddha FM' }).click();

  // Resume in a new chat copies the project prompt to the clipboard.
  await page.getByRole('button', { name: 'Resume in a new chat' }).click();
  await expect(page.getByText('Resume prompt copied.')).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('Let\'s carry on with "Black Buddha FM"');
  expect(copied).toContain('Next step: Edit and mix (Ep 3)');
  expect(copied).toContain('Open tasks (6):');

  // Create a task.
  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel('New task title').fill('Book studio time');
  await page.getByRole('button', { name: 'Add task' }).click();
  const row = page.getByTestId('task-row').filter({ hasText: 'Book studio time' });
  await expect(row).toBeVisible();

  // Read its id and version, then edit the title in the UI (the user's change).
  const tasks = await (await request.get(page.url().replace(/#.*/, '') + `api/projects/${page.url().split('/project/')[1]}/tasks`)).json();
  const task = tasks.find((t: any) => t.title === 'Book studio time');
  await row.click();
  const title = page.getByLabel('Title');
  await title.fill('Book studio time for Ep 4');
  await title.press('Enter');
  await expect(page.getByRole('dialog').getByText('Changed title')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  // The agent, working from the old version, changes the title and the priority.
  drop('e2e-conflict.json', {
    schema_version: 1,
    file_id: 'e2e-conflict',
    created_at: new Date().toISOString(),
    agent: 'Claude',
    summary: 'Tidy the studio task',
    changes: [
      { change_id: 'e2e-1', op: 'update', entity: 'task', id: task.id, base_version: task.version, fields: { title: 'Book studio (agent)', priority: 'high' } },
    ],
  });

  // It waits in the project's inbox with the conflict marked.
  const panel = page.getByTestId('inbox-file').filter({ hasText: 'e2e-conflict.json' });
  await expect(panel).toBeVisible({ timeout: 3000 });
  await expect(panel.getByTestId('conflict')).toHaveCount(1);
  const apply = panel.getByRole('button', { name: 'Apply' });
  await expect(apply).toBeDisabled();
  await panel.getByRole('button', { name: /Keep mine/ }).click();
  await expect(apply).toBeEnabled();
  await apply.click();

  // My title stays; the agent's priority merges.
  await expect(panel).toHaveCount(0);
  const studio = page.getByTestId('task-row').filter({ hasText: 'Book studio time for Ep 4' });
  await expect(studio).toContainText('High');

  // The Activity tab shows the agent batch with the file name; undo reverses it.
  await page.locator('.tabs button', { hasText: 'Activity' }).click();
  const item = page.getByTestId('feed-item').filter({ hasText: 'e2e-conflict.json' });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('feed-item').filter({ hasText: 'e2e-conflict.json' })).toContainText('undone');
  await page.locator('.tabs button', { hasText: 'List' }).click();
  await expect(studio).not.toContainText('High');
});

test('send a task to the agent with a note; the agent replies', async ({ page }) => {
  await page.goto('/#/projects');
  await page.getByTestId('project-card').filter({ hasText: 'Music Empire mod' }).click();
  await page.getByTestId('task-row').filter({ hasText: 'Balance chart payouts' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Note for the agent').fill('Keep payouts under 2x the base rate');
  await dialog.getByRole('button', { name: 'Send to agent' }).first().click();
  await expect(dialog.getByTestId('agent-message')).toContainText('Do this next');
  await expect(dialog.getByTestId('agent-message')).toContainText('Keep payouts under 2x');
  await expect(dialog.getByText('Sent to agent')).toBeVisible();

  // The agent sees it in the snapshot and replies.
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(agentDir, 'snapshot.json'), 'utf8')).messages.length).toBeGreaterThan(0);
  const msg = JSON.parse(fs.readFileSync(path.join(agentDir, 'snapshot.json'), 'utf8')).messages.find((m: any) => m.kind === 'do_next');
  expect(msg.about).toBe('Balance chart payouts');
  drop('e2e-reply.json', {
    schema_version: 1,
    file_id: 'e2e-reply',
    created_at: new Date().toISOString(),
    agent: 'Claude',
    summary: 'Payouts balanced',
    changes: [],
    message_replies: [{ message_id: msg.id, reply: 'Capped payouts at 1.8x' }],
  });
  await expect(dialog.getByText('Capped payouts at 1.8x')).toBeVisible({ timeout: 3000 });
  await expect(dialog.getByText('Seen by the agent')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('task-row').filter({ hasText: 'Balance chart payouts' })).not.toContainText('Sent to agent');
});

test('a second tab saving an old version gets a conflict message', async ({ browser }) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  for (const p of [a, b]) {
    await p.goto('/#/projects');
    await p.getByTestId('project-card').filter({ hasText: 'Music Empire mod' }).click();
    await p.getByTestId('task-row').filter({ hasText: 'Balance chart payouts' }).click();
  }
  // Tab B starts editing, then tab A saves first.
  await b.getByLabel('Title').fill('Balance payouts (tab B)');
  await a.getByLabel('Title').fill('Balance payouts (tab A)');
  await a.getByLabel('Title').press('Enter');
  await expect(a.getByRole('dialog').getByText('Changed title')).toBeVisible();
  await b.waitForTimeout(500); // tab B has heard about the change by now
  await b.getByLabel('Title').press('Enter');
  await expect(b.getByText(/Not saved/)).toBeVisible();
  await expect(b.getByLabel('Title')).toHaveValue('Balance payouts (tab A)');
});

test('Weekly review page and quiet projects, time stats and estimates', async ({ page }) => {
  await page.goto('/');

  // Weekly review link in sidebar
  await page.getByRole('button', { name: 'Weekly review' }).click();
  await expect(page).toHaveURL(/#\/weekly$/);
  await expect(page.getByRole('heading', { name: 'Weekly review' })).toBeVisible();
  await expect(page.getByTestId('stat-done')).toBeVisible();
  await expect(page.getByTestId('stat-slipped')).toBeVisible();
  await expect(page.getByTestId('stat-quiet')).toBeVisible();
  await expect(page.getByTestId('stat-questions')).toBeVisible();
  await expect(page.getByTestId('section-slipped')).toBeVisible();
  await expect(page.getByTestId('section-quiet')).toBeVisible();
  await expect(page.getByTestId('section-completed')).toBeVisible();

  // All projects shows quiet pill and worked-on date
  await page.getByRole('button', { name: 'All projects' }).click();
  const bbfmCard = page.getByTestId('project-card').filter({ hasText: 'Black Buddha FM' });
  await expect(bbfmCard.getByTestId('worked-on-date')).toBeVisible();

  // Project details shows time spent vs estimate
  await bbfmCard.click();
  await expect(page.getByTestId('project-time-stats')).toBeVisible();
  await expect(page.getByTestId('project-time-stats')).toContainText('logged');
  await expect(page.getByTestId('project-time-stats')).toContainText('estimated');

  // Task row shows ~3h estimate
  const narrRow = page.getByTestId('task-row').filter({ hasText: 'Record narration (Ep 4)' });
  await expect(narrRow).toContainText('~3h');
});
