import { test, expect } from '@playwright/test';

test.describe('Offline IndexedDB Persistence & Reconnection (Playwright E2E)', () => {
  test('persists offline mutations across page reload and reconciles on reconnect', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // 1. Initial online load
    await page.goto('/');
    await expect(page.locator('.connection-badge')).toContainText('Connected', { timeout: 10000 });

    // 2. Simulate network going offline
    await context.setOffline(true);

    // 3. Verify OfflineBanner appears
    await expect(page.locator('.offline-banner')).toBeVisible({ timeout: 5000 });

    // 4. Create task while offline
    const offlineTaskTitle = `Offline Task ${Date.now()}`;
    await page.click('#btn-new-task');
    await page.fill('#task-title', offlineTaskTitle);
    await page.fill('#task-description', 'Created while completely offline');
    await page.selectOption('#task-status', 'todo');
    await page.click('#btn-submit-task');

    // 5. Verify task renders with pending indicator
    const offlineCard = page.locator(`[data-testid="task-card"]:has-text("${offlineTaskTitle}")`);
    await expect(offlineCard).toBeVisible();
    await expect(offlineCard.locator('.pending-tag')).toBeVisible();

    // 6. Verify task is durably persisted in client IndexedDB
    const isStoredInIDB = await page.evaluate(async (title) => {
      return new Promise<boolean>((resolve) => {
        const req = window.indexedDB.open('live_collab_workspace_db');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('tasks', 'readonly');
          const store = tx.objectStore('tasks');
          const allReq = store.getAll();
          allReq.onsuccess = () => {
            const tasks = allReq.result as Array<{ title: string }>;
            resolve(tasks.some((t) => t.title === title));
          };
          allReq.onerror = () => resolve(false);
        };
        req.onerror = () => resolve(false);
      });
    }, offlineTaskTitle);
    expect(isStoredInIDB).toBe(true);

    // 7. Re-enable network to allow HTTP navigation and reload page
    await context.setOffline(false);
    await page.reload();

    // 8. Verify task was restored from IndexedDB local storage upon reload
    const restoredCard = page.locator(`[data-testid="task-card"]:has-text("${offlineTaskTitle}")`);
    await expect(restoredCard).toBeVisible({ timeout: 10000 });

    // 9. Verify connection re-established and pending badge clears
    await expect(page.locator('.connection-badge')).toContainText('Connected', { timeout: 10000 });
    await expect(page.locator('.offline-banner')).not.toBeVisible({ timeout: 5000 });

    // Clean up
    await restoredCard.click();
    await page.click('#btn-delete-task');
    await context.close();
  });
});
