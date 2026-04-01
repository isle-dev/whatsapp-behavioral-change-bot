import express, { Request, Response } from 'express';
import axios from 'axios';
import { processInbound } from '../modules/orchestration';
import { InteractiveMessage, WaLocation } from '../types';

const router = express.Router();

// WhatsApp Business API configuration
const WHATSAPP_API_URL = 'https://graph.facebook.com/v18.0';
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

// Minimal inbound message shape from the Business API
interface WaTextContent { body: string }
interface WaButtonReply { id: string; title: string }
interface WaListReply  { id: string; title: string }
interface WaInteractive {
  type: 'button_reply' | 'list_reply';
  button_reply?: WaButtonReply;
  list_reply?: WaListReply;
}
interface WaMessage {
  from: string;
  type: 'text' | 'interactive' | 'location' | string;
  text?: WaTextContent;
  interactive?: WaInteractive;
  location?: WaLocation;
}
interface WaWebhookBody {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: WaMessage[];
      };
    }>;
  }>;
}

// Webhook verification endpoint
router.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook verified successfully');
      res.status(200).send(challenge);
    } else {
      console.log('❌ Webhook verification failed');
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// Webhook message endpoint
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body as WaWebhookBody;

    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          for (const message of change.value?.messages || []) {
            await handleIncomingMessage(message);
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.sendStatus(500);
  }
});

function extractInput(message: WaMessage): string {
  if (message.type === 'text') return message.text?.body || '';
  if (message.type === 'interactive' && message.interactive) {
    const ir = message.interactive;
    if (ir.type === 'button_reply') return ir.button_reply?.id || ir.button_reply?.title || '';
    if (ir.type === 'list_reply')   return ir.list_reply?.id  || ir.list_reply?.title  || '';
  }
  return '';
}

async function handleIncomingMessage(message: WaMessage): Promise<void> {
  try {
    const from = message.from;
    const input = extractInput(message);
    const location = message.type === 'location' ? message.location : undefined;

    console.log(`📨 Received ${message.type} message from ${from}: "${input}"`);

    if (!input.trim() && !location) return;

    const result = await processInbound(from, input, location);

    for (const text of result.messages || []) {
      const isLast = text === (result.messages || []).at(-1);
      if (isLast && result.interactive) {
        await sendInteractiveMessage(from, text, result.interactive);
      } else {
        await sendTextMessage(from, text);
      }
    }
  } catch (error) {
    console.error('❌ Error handling incoming message:', error);
    await sendTextMessage(message.from, "I'm sorry, something went wrong. Please try again.");
  }
}

async function sendTextMessage(to: string, text: string): Promise<unknown> {
  return sendWhatsAppPayload(to, { type: 'text', text: { body: text } });
}

async function sendInteractiveMessage(
  to: string,
  fallbackText: string,
  interactive: InteractiveMessage
): Promise<unknown> {
  const payload = {
    type: 'interactive',
    interactive: {
      ...interactive,
      body: interactive.body || { text: fallbackText },
    },
  };
  return sendWhatsAppPayload(to, payload);
}

async function sendWhatsAppPayload(to: string, payload: unknown): Promise<unknown> {
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    throw new Error('WhatsApp API credentials not configured');
  }

  try {
    const response = await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: 'whatsapp', to, ...(payload as object) },
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('❌ Error sending WhatsApp message:', error.response?.data || error.message);
    } else {
      console.error('❌ Error sending WhatsApp message:', error);
    }
    throw error;
  }
}

// Health check for webhook
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'OK',
    webhook: 'WhatsApp Business API Webhook',
    timestamp: new Date().toISOString(),
    config: {
      hasAccessToken: !!ACCESS_TOKEN,
      hasPhoneNumberId: !!PHONE_NUMBER_ID,
      hasVerifyToken: !!VERIFY_TOKEN,
    },
  });
});

export default router;
