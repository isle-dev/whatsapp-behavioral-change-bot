import dotenv from 'dotenv';
dotenv.config({ override: true });

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import whatsappBot from './services/whatsappBot';
import webhookRoutes from './routes/webhook';
import adminRoutes from './routes/admin';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/webhook', webhookRoutes);
app.use('/admin', adminRoutes);

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'OK',
    message: 'WhatsApp Chatbot is running',
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (_req: Request, res: Response) => {
  res.json({
    message: 'WhatsApp Chatbot API',
    version: '1.0.0',
    endpoints: { health: '/health', webhook: '/webhook' },
  });
});

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
  });
});

// 404 handler
app.use('*', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 WhatsApp Chatbot server running on port ${PORT}`);
  console.log(`📱 Health check: http://localhost:${PORT}/health`);

  if (process.env.USE_WHATSAPP === 'true') {
    whatsappBot.initialize();
  }
});

export default app;
