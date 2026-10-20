import { Router } from 'express';
import { addClient } from '../lib/events.js';

const router = Router();

router.get('/', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  res.write(`event: ready\ndata: {}\n\n`);
  const remove = addClient(req.user, res);
  req.on('close', remove);
});

export default router;
