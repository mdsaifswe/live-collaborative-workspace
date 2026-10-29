import http from 'http';
import express from 'express';
import { performance } from 'perf_hooks';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { CollaborativeWebSocketServer } from '../src/server/ws-server';
import { AuthoritativeStore } from '../src/server/store';
import { Task, Comment } from '../src/shared/types';
import { createServer as createViteServer, ViteDevServer } from 'vite';

interface ClientPageWrapper {
  id: string;
  name: string;
  context: BrowserContext;
  page: Page;
}

async function runDiagnostic() {
  console.log('--- STARTING TAIL LATENCY DIAGNOSTIC ---');

  const app = express();
  const server = http.createServer(app);
  server.on('connection', (socket) => socket.setNoDelay(true));
  const store = new AuthoritativeStore();
  const wsServer = new CollaborativeWebSocketServer(server, store);

  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const address = server.address();
  const serverPort = typeof address === 'object' && address ? address.port : 3001;
  const wsUrl = `ws://localhost:${serverPort}`;

  const vite: ViteDevServer = await createViteServer({
    server: { port: 5180, host: '127.0.0.1' },
    logLevel: 'error',
  });
  await vite.listen();
  const clientUrl = 'http://127.0.0.1:5180';

  const browser: Browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
      '--renderer-process-limit=30',
      '--disable-extensions',
      '--disable-component-extensions-with-background-pages',
      '--mute-audio',
    ],
  });

  const clientWrappers: ClientPageWrapper[] = [];
  const workspaceId = 'diagnostic-sprint';

  console.log('Connecting 20 clients...');
  for (let i = 0; i < 20; i++) {
    const clientId = `browser-client-${i.toString().padStart(2, '0')}`;
    const clientName = `Browser User ${i + 1}`;
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await context.newPage();

    await page.addInitScript(({ cId, cName, wUrl, wId }) => {
      localStorage.setItem('collab_user', JSON.stringify({
        id: cId,
        name: cName,
        color: '#' + Math.floor(Math.random() * 16777215).toString(16),
      }));
      // @ts-expect-error test config
      window.__COLLAB_WS_URL__ = wUrl;
      // @ts-expect-error test config
      window.__COLLAB_WS_ID__ = wId;
      // @ts-expect-error test config
      window.__collab_deliveries = [];
    }, { cId: clientId, cName: clientName, wUrl: wsUrl, wId: workspaceId });

    await page.goto(`${clientUrl}?workspaceId=${encodeURIComponent(workspaceId)}&wsUrl=${encodeURIComponent(wsUrl)}`);
    await page.waitForSelector('.connection-badge:has-text("Connected")', { timeout: 15000 });
    clientWrappers.push({ id: clientId, name: clientName, context, page });
  }

  console.log('All 20 clients connected. Running diagnostic workload (66 ops)...');
  await new Promise((r) => setTimeout(r, 500));

  const totalOps = 66;
  const warmupOps = 10;
  const createdTaskIds: string[] = [];

  for (let opIdx = 0; opIdx < totalOps; opIdx++) {
    const originClient = clientWrappers[opIdx % clientWrappers.length];
    const opTypeChoice = opIdx % 3;
    const opId = `diag-op-${opIdx.toString().padStart(4, '0')}-${Math.random().toString(36).substring(2, 6)}`;

    const nodeT0 = performance.timeOrigin + performance.now();

    let submission: { opId: string; startMonoTime: number; beforeSend: number; afterSend: number };

    if (opTypeChoice === 0 || createdTaskIds.length === 0) {
      const taskId = `task-diag-${opIdx}`;
      createdTaskIds.push(taskId);

      submission = await originClient.page.evaluate(async ({ tId, oId, uId }) => {
        const tStart = performance.timeOrigin + performance.now();
        // @ts-expect-error bench hook
        const bench = window.__collab_bench;
        const tBeforeSend = performance.timeOrigin + performance.now();
        const resOpId = await bench.syncOrchestrator.createTask({
          id: tId,
          title: `Diag Task ${tId}`,
          description: `By ${uId}`,
          status: 'todo',
          priority: 'high',
          createdBy: uId,
        }, oId);
        const tAfterSend = performance.timeOrigin + performance.now();
        return { opId: resOpId, startMonoTime: tStart, beforeSend: tBeforeSend, afterSend: tAfterSend };
      }, { tId: taskId, oId: opId, uId: originClient.id });
    } else if (opTypeChoice === 1) {
      const targetTaskId = createdTaskIds[Math.floor(Math.random() * createdTaskIds.length)];

      submission = await originClient.page.evaluate(async ({ tId, oId, idx }) => {
        const tStart = performance.timeOrigin + performance.now();
        // @ts-expect-error bench hook
        const bench = window.__collab_bench;
        const tBeforeSend = performance.timeOrigin + performance.now();
        const resOpId = await bench.syncOrchestrator.updateTask(tId, {
          status: idx % 2 === 0 ? 'in_progress' : 'done',
          description: `Diag update #${idx}`,
        }, oId);
        const tAfterSend = performance.timeOrigin + performance.now();
        return { opId: resOpId, startMonoTime: tStart, beforeSend: tBeforeSend, afterSend: tAfterSend };
      }, { tId: targetTaskId, oId: opId, idx: opIdx });
    } else {
      const targetTaskId = createdTaskIds[Math.floor(Math.random() * createdTaskIds.length)];

      submission = await originClient.page.evaluate(async ({ tId, oId, uName }) => {
        const tStart = performance.timeOrigin + performance.now();
        // @ts-expect-error bench hook
        const bench = window.__collab_bench;
        const tBeforeSend = performance.timeOrigin + performance.now();
        const resOpId = await bench.syncOrchestrator.createComment(tId, `Diag comment by ${uName}`, oId);
        const tAfterSend = performance.timeOrigin + performance.now();
        return { opId: resOpId, startMonoTime: tStart, beforeSend: tBeforeSend, afterSend: tAfterSend };
      }, { tId: targetTaskId, oId: opId, uName: originClient.name });
    }

    const nodeT1 = performance.timeOrigin + performance.now();
    const evalDuration = nodeT1 - nodeT0;
    const internalDuration = submission.afterSend - submission.startMonoTime;
    const nodeCdpLag = (submission.startMonoTime - nodeT0);

    if (evalDuration > 100 || opIdx === 10) {
      console.log(`[Op ${opIdx} ${opId}] evalDuration=${evalDuration.toFixed(1)}ms nodeCdpLag=${nodeCdpLag.toFixed(1)}ms internalSend=${internalDuration.toFixed(1)}ms`);
    }

    await new Promise((r) => setTimeout(r, 140));
  }

  // Drain and harvest
  await new Promise((r) => setTimeout(r, 1000));
  console.log('Harvesting deliveries...');
  const allDeliveries: unknown[] = [];
  for (const c of clientWrappers) {
    const list = await c.page.evaluate(() => {
      // @ts-expect-error test buffer
      return window.__collab_deliveries || [];
    });
    allDeliveries.push(...list);
  }
  console.log(`Harvested ${allDeliveries.length} total deliveries.`);

  // Cleanup
  await browser.close();
  await vite.close();
  await wsServer.close();
  await new Promise<void>((r) => server.close(() => r()));
  console.log('--- DIAGNOSTIC COMPLETE ---');
}

runDiagnostic().catch((e) => console.error('Diagnostic error:', e));
