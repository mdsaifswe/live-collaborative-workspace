import { test, expect } from '@playwright/test';
import axeCore from 'axe-core';

test.describe('Accessibility & Keyboard Navigation (a11y)', () => {
  test('passes automated axe accessibility scan on main workspace', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.connection-badge')).toContainText('Connected', { timeout: 10000 });

    // Inject and run axe-core
    await page.evaluate(axeCore.source);
    const results = await page.evaluate(async () => {
      // @ts-expect-error axe is injected globally
      return await window.axe.run(document, {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa'],
        },
      });
    });

    const criticalViolations = results.violations.filter(
      (v: { impact: string }) => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(criticalViolations).toEqual([]);
  });

  test('supports full keyboard navigation and escape to close modals', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.connection-badge')).toContainText('Connected', { timeout: 10000 });

    // Press 'n' to open New Task modal via keyboard shortcut
    await page.keyboard.press('n');
    await expect(page.locator('#new-task-modal-title')).toBeVisible();

    // Verify task title input has focus
    await expect(page.locator('#task-title')).toBeFocused();

    // Press Escape to close modal
    await page.keyboard.press('Escape');
    await expect(page.locator('#new-task-modal-title')).not.toBeVisible();

    // Press 'd' to open Diagnostics Drawer via keyboard shortcut
    await page.keyboard.press('d');
    await expect(page.locator('h2:has-text("Diagnostics & State")')).toBeVisible();

    // Press Escape to close drawer
    await page.keyboard.press('Escape');
    await expect(page.locator('h2:has-text("Diagnostics & State")')).not.toBeVisible();
  });
});
