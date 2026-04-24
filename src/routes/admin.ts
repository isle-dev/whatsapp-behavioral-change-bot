import express, { Request, Response, NextFunction } from 'express';
import whatsappBot from '../services/whatsappBot';

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

export default router;
