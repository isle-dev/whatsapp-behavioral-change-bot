import express, { Request, Response, NextFunction } from 'express';
import conversationManager from '../services/conversationManager';
import llmService from '../services/llmService';
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
    const llmConfig = llmService.getConfig();
    const stats = conversationManager.getStats();
    res.json({ bot: botStatus, llm: llmConfig, statistics: stats, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('❌ Error getting status:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

router.get('/conversations', requireAdmin, (_req: Request, res: Response) => {
  try {
    const conversations = conversationManager.getAllConversations();
    res.json({ conversations, count: Object.keys(conversations).length });
  } catch (error) {
    console.error('❌ Error getting conversations:', error);
    res.status(500).json({ error: 'Failed to get conversations' });
  }
});

router.get('/conversations/:id', requireAdmin, (req: Request, res: Response) => {
  try {
    const conversation = conversationManager.getConversation(req.params.id);
    res.json({ conversation: conversation.getSummary(), messages: conversation.getFullMessages() });
  } catch (error) {
    console.error('❌ Error getting conversation:', error);
    res.status(500).json({ error: 'Failed to get conversation' });
  }
});

router.delete('/conversations/:id', requireAdmin, (req: Request, res: Response) => {
  try {
    const success = conversationManager.clearConversation(req.params.id);
    if (success) {
      res.json({ message: 'Conversation cleared successfully' });
    } else {
      res.status(404).json({ error: 'Conversation not found' });
    }
  } catch (error) {
    console.error('❌ Error clearing conversation:', error);
    res.status(500).json({ error: 'Failed to clear conversation' });
  }
});

router.put('/config/llm', requireAdmin, (req: Request, res: Response) => {
  try {
    const { model, maxTokens, temperature } = req.body as {
      model?: string;
      maxTokens?: number;
      temperature?: number;
    };
    const config: { model?: string; maxTokens?: number; temperature?: number } = {};
    if (model) config.model = model;
    if (maxTokens) config.maxTokens = maxTokens;
    if (temperature) config.temperature = temperature;
    llmService.updateConfig(config);
    res.json({ message: 'LLM configuration updated successfully', config: llmService.getConfig() });
  } catch (error) {
    console.error('❌ Error updating LLM config:', error);
    res.status(500).json({ error: 'Failed to update LLM configuration' });
  }
});

router.get('/config/llm', requireAdmin, (_req: Request, res: Response) => {
  try {
    res.json(llmService.getConfig());
  } catch (error) {
    console.error('❌ Error getting LLM config:', error);
    res.status(500).json({ error: 'Failed to get LLM configuration' });
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
    const stats = conversationManager.getStats();
    const botStatus = whatsappBot.getStatus();
    res.json({
      conversations: stats,
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
