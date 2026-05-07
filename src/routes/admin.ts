import express, { Request, Response, NextFunction } from 'express';
import whatsappBot from '../services/whatsappBot';
import { query } from '../modules/db';

const router = express.Router();

const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.ADMIN_API_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
};

router.get('/status', requireAdmin, (_req: Request, res: Response) => {
  try {
    const botStatus = whatsappBot.getStatus();
    res.json({ bot: botStatus, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('❌ Error getting status:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

router.post('/test-message', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { to, message } = req.body as { to?: string; message?: string };
    if (!to || !message) {
      res.status(400).json({ error: 'Missing required fields: to, message' });
      return;
    }
    await whatsappBot.sendMessage(to, message);
    res.json({ message: 'Test message sent successfully' });
  } catch (error) {
    console.error('❌ Error sending test message:', error);
    res.status(500).json({ error: 'Failed to send test message' });
  }
});

router.get('/stats', requireAdmin, (_req: Request, res: Response) => {
  try {
    const botStatus = whatsappBot.getStatus();
    res.json({
      bot: botStatus,
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version,
        platform: process.platform,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Error getting statistics:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

router.get('/health', requireAdmin, (_req: Request, res: Response) => {
  res.json({ status: 'OK', admin: 'Admin API is running', timestamp: new Date().toISOString() });
});

router.get('/adherence', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT
        user_id,
        COUNT(*)                                                        AS total_doses,
        SUM(CASE WHEN taken THEN 1 ELSE 0 END)                         AS taken_doses,
        ROUND(100.0 * SUM(CASE WHEN taken THEN 1 ELSE 0 END) / COUNT(*), 1) AS adherence_pct,
        COUNT(*) FILTER (WHERE barrier IS NOT NULL)                     AS doses_with_barrier,
        MAX(recorded_at)                                                AS last_event_at
      FROM adherence_events
      GROUP BY user_id
      ORDER BY last_event_at DESC
    `);
    res.json({ users: result?.rows ?? [], timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('❌ Error fetching adherence data:', err);
    res.status(500).json({ error: 'Failed to fetch adherence data' });
  }
});

router.get('/adherence/barriers', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT
        COALESCE(com_b_barrier, 'unclassified') AS category,
        COUNT(*)                                AS count,
        ARRAY_AGG(barrier ORDER BY recorded_at DESC) FILTER (WHERE barrier IS NOT NULL) AS examples
      FROM adherence_events
      WHERE taken = false
      GROUP BY com_b_barrier
      ORDER BY count DESC
    `);
    res.json({ barriers: result?.rows ?? [], timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('❌ Error fetching barrier data:', err);
    res.status(500).json({ error: 'Failed to fetch barrier data' });
  }
});

export default router;
