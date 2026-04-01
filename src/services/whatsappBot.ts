import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { processInbound } from '../modules/orchestration';
import { WaLocation } from '../types';

// Demo filter: only process messages that start with "Hi Medi" or "*"
const DEMO_TRIGGER = /^\s*(hi\s+medi\b|\*)/i;

class WhatsAppBot {
  private client: Client | null;
  private isReady: boolean;
  private processedMessages: Set<string>;
  private sentMessageIds: Set<string>;

  constructor() {
    this.client = null;
    this.isReady = false;
    this.processedMessages = new Set();
    this.sentMessageIds = new Set();
  }

  initialize(): void {
    console.log('🤖 Initializing WhatsApp Bot...');

    this.client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
    });

    this.setupEventHandlers();
    this.client.initialize();
  }

  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.on('qr', (qr) => {
      console.log('📱 QR Code received, scan with WhatsApp:');
      qrcode.generate(qr, { small: true });
    });

    this.client.on('ready', () => {
      console.log('✅ WhatsApp Bot is ready!');
      console.log('📱 Bot is now listening for messages...');
      console.log('💡 Tip: New users are automatically onboarded on first message.\n');
      this.isReady = true;
    });

    this.client.on('message', async (message) => {
      console.log('🔔 message event');
      if (message.fromMe) {
        console.log('   ⏭️  Ignoring self message on message event\n');
        return;
      }
      await this.handleMessage(message);
    });

    this.client.on('message_create', async (message) => {
      console.log('📝 message_create event. fromMe:', !!message.fromMe);

      const serializedId = message.id && (message.id._serialized || message.id.id);
      if (serializedId && this.sentMessageIds.has(serializedId)) {
        console.log('   ⏭️  Ignoring bot-sent message (tracked id)\n');
        return;
      }

      if (message.fromMe) {
        try {
          const chat = await message.getChat();
          if (chat.isGroup) {
            console.log('   ⏭️  Ignoring self message in group\n');
            return;
          }
          if (chat.isStatus) {
            console.log('   ⏭️  Ignoring status chat\n');
            return;
          }
          await this.handleMessage(message);
        } catch (e) {
          console.log('   ⚠️  Could not check chat type for message_create:', (e as Error).message);
        }
      }
    });

    this.client.on('message_revoke_everyone', () => {
      console.log('🗑️ Message revoked for everyone');
    });

    this.client.on('auth_failure', (msg) => {
      console.error('❌ Authentication failed:', msg);
      console.log('💡 Please scan the QR code again or check your authentication');
    });

    this.client.on('disconnected', (reason) => {
      console.log(`🔌 WhatsApp Bot disconnected: ${reason}`);
      console.log('⏸️  Bot is no longer listening for messages');
      this.isReady = false;
    });

    this.client.on('loading_screen', (percent, message) => {
      console.log(`⏳ Loading WhatsApp: ${percent}% - ${message}`);
    });

    this.client.on('authenticated', () => {
      console.log('🔐 WhatsApp authentication successful');
    });
  }

  async handleMessage(message: Message): Promise<void> {
    try {
      const messageId =
        (message.id && (message.id._serialized || message.id.id)) ||
        `${message.from}-${message.timestamp}`;

      if (this.processedMessages.has(messageId)) {
        console.log(`🔄 Skipping duplicate message: ${messageId}`);
        return;
      }
      this.processedMessages.add(messageId);

      if (this.processedMessages.size > 1000) {
        const oldMessages = Array.from(this.processedMessages).slice(0, 500);
        oldMessages.forEach((id) => this.processedMessages.delete(id));
      }

      const timestamp = new Date().toLocaleTimeString();
      const messageType = message.type || 'text';
      const body = typeof message.body === 'string' ? message.body : '';
      const loc = message.location;
      const location: WaLocation | undefined =
        messageType === 'location' && loc && typeof loc.latitude === 'number'
          ? { latitude: loc.latitude, longitude: loc.longitude }
          : undefined;

      let contactName = 'Unknown';
      try {
        const fromContact = await message.getContact();
        contactName = fromContact.name || fromContact.pushname || fromContact.number || 'Unknown';
      } catch (error) {
        console.log(`   ⚠️  Could not fetch contact info: ${(error as Error).message}`);
        contactName = 'Unknown Contact';
      }

      console.log(`\n📨 [${timestamp}] Message received:`);
      console.log(`   🆔 Message ID: ${messageId}`);
      console.log(`   👤 From: ${contactName} (${message.from})`);
      console.log(`   📝 Type: ${messageType}`);
      console.log(`   💬 Content: "${body}"`);
      console.log(`   🤖 From me: ${message.fromMe ? 'Yes' : 'No'}`);
      console.log(`   ⏰ Timestamp: ${message.timestamp}`);

      if (!location && !DEMO_TRIGGER.test(body)) {
        console.log('   ⏭️  Ignored (start with "Hi Medi" or "*" to trigger bot)\n');
        return;
      }

      const strippedBody = body.replace(DEMO_TRIGGER, '').replace(/^\*+|\*+$/g, '').trim();

      console.log('   🔄 Processing message...');

      const result = await processInbound(message.from, strippedBody, location);
      const replies = result.messages || [];

      let sent: Message | undefined;
      for (const reply of replies) {
        sent = await this.sendMessage(message.from, reply);
      }
      if (!sent && replies.length === 0) return;
      if (sent && sent.id && (sent.id._serialized || sent.id.id)) {
        const sid = sent.id._serialized || sent.id.id;
        this.sentMessageIds.add(sid);
        if (this.sentMessageIds.size > 2000) {
          this.sentMessageIds = new Set(Array.from(this.sentMessageIds).slice(-1000));
        }
      }

      const responseTime = new Date().toLocaleTimeString();
      console.log(`   ✅ [${responseTime}] Response sent successfully to ${contactName}\n`);
    } catch (error) {
      const errorTime = new Date().toLocaleTimeString();
      console.error(`\n❌ [${errorTime}] Error handling message from ${message.from}:`);
      console.error(`   📝 Original message: "${message.body}"`);
      console.error(`   🚨 Error: ${(error as Error).message}`);
      console.error(`   📍 Stack: ${(error as Error).stack}\n`);

      const errorMessage = "I'm sorry, I encountered an error processing your message. Please try again.";
      console.log('   🔄 Sending error message to user...');
      const sent = await this.sendMessage(message.from, errorMessage);
      if (sent && sent.id && (sent.id._serialized || sent.id.id)) {
        const sid = sent.id._serialized || sent.id.id;
        this.sentMessageIds.add(sid);
      }
      console.log('   ✅ Error message sent\n');
    }
  }

  async sendMessage(to: string, message: string): Promise<Message> {
    if (!this.isReady || !this.client) {
      throw new Error('WhatsApp client not ready');
    }
    return this.client.sendMessage(to, message);
  }

  async sendTyping(to: string): Promise<void> {
    try {
      if (!this.isReady || !this.client) return;
      await this.client.sendStateTyping(to);
    } catch (error) {
      console.error('❌ Error sending typing indicator:', error);
    }
  }

  async stopTyping(): Promise<void> {
    try {
      if (!this.isReady || !this.client) return;
      await this.client.clearState();
    } catch (error) {
      console.error('❌ Error stopping typing indicator:', error);
    }
  }

  getStatus(): { isReady: boolean; timestamp: string } {
    return { isReady: this.isReady, timestamp: new Date().toISOString() };
  }
}

export default new WhatsAppBot();
