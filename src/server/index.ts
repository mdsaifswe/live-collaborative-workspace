import http from 'http';
import express from 'express';
import cors from 'cors';
import { CollaborativeWebSocketServer } from './ws-server';
import { SERVER_PORT } from '../shared/constants';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wsServer = new CollaborativeWebSocketServer(server);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    uptime: process.uptime(),
  });
});

app.get('/api/workspace/:id/snapshot', (req, res) => {
  const snapshot = wsServer.getStore().getSnapshot(req.params.id);
  res.json(snapshot);
});

// Reset endpoint for testing & benchmark isolation
app.post('/api/test/reset', (_req, res) => {
  wsServer.getStore().clearAll();
  res.json({ status: 'reset_ok' });
});

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : SERVER_PORT;

if (process.env.NODE_ENV !== 'test') {
  server.listen(port, () => {
    console.log(`[Collab Server] Listening on http://localhost:${port}`);
    console.log(`[Collab Server] WebSocket ready on ws://localhost:${port}`);
  });
}

export { app, server, wsServer };
