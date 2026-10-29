import { test, expect } from '@playwright/test';

test.describe('Multi-Client Collaboration (Playwright E2E)', () => {
  test('two independent browser clients synchronize tasks and comments in real time', async ({ browser }) => {
    // 1. Create two independent browser contexts (simulating two different users on different machines)
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // 2. Open workspace in both clients
    await pageA.goto('/');
    await pageB.goto('/');

    // 3. Verify both clients connect and display workspace header
    await expect(pageA.locator('header h1')).toBeVisible();
    await expect(pageB.locator('header h1')).toBeVisible();

    await expect(pageA.locator('.connection-badge')).toContainText('Connected', { timeout: 10000 });
    await expect(pageB.locator('.connection-badge')).toContainText('Connected', { timeout: 10000 });

    // 4. Client A creates a new task
    const taskTitle = `E2E Collab Task ${Date.now()}`;
    await pageA.click('#btn-new-task');
    await expect(pageA.locator('#new-task-modal-title')).toBeVisible();

    await pageA.fill('#task-title', taskTitle);
    await pageA.fill('#task-description', 'Real-time synchronization verification between two browsers');
    await pageA.selectOption('#task-status', 'todo');
    await pageA.selectOption('#task-priority', 'urgent');

    await pageA.click('#btn-submit-task');

    // 5. Client A sees task optimistically in "To Do"
    const cardA = pageA.locator(`[data-testid="column-todo"] [data-testid="task-card"]:has-text("${taskTitle}")`);
    await expect(cardA).toBeVisible();

    // 6. Client B (WITHOUT REFRESHING!) observes task render in "To Do"
    const cardB = pageB.locator(`[data-testid="column-todo"] [data-testid="task-card"]:has-text("${taskTitle}")`);
    await expect(cardB).toBeVisible({ timeout: 5000 });

    // 7. Client B clicks the task card to open TaskDetailsModal
    await cardB.click();
    await expect(pageB.locator('#task-detail-title')).toContainText(taskTitle);

    // 8. Client B moves status to "In Progress"
    await pageB.selectOption('#task-status-change', 'in_progress');

    // 9. Client A observes the task move to the "In Progress" column in real time
    const inProgressCardA = pageA.locator(`[data-testid="column-in_progress"] [data-testid="task-card"]:has-text("${taskTitle}")`);
    await expect(inProgressCardA).toBeVisible({ timeout: 5000 });

    // 10. Client B posts a comment in the task modal
    const commentText = `Live update from Client B at ${Date.now()}`;
    await pageB.fill('#comment-input', commentText);
    await pageB.click('#btn-post-comment');

    await expect(pageB.locator(`[data-testid="comment-item"]:has-text("${commentText}")`)).toBeVisible();

    // 11. Client A opens the task modal and observes Client B's comment
    await inProgressCardA.click();
    await expect(pageA.locator(`[data-testid="comment-item"]:has-text("${commentText}")`)).toBeVisible({ timeout: 5000 });

    // 12. Clean up
    await pageA.click('#btn-delete-task');
    await expect(pageA.locator(`[data-testid="task-card"]:has-text("${taskTitle}")`)).not.toBeVisible();
    await expect(pageB.locator(`[data-testid="task-card"]:has-text("${taskTitle}")`)).not.toBeVisible({ timeout: 5000 });

    await contextA.close();
    await contextB.close();
  });
});
