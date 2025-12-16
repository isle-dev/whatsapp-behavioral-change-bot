const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const llmService = require('./llmService');
const conversationManager = require('./conversationManager');

const HI_MEDI_REGEX = /^\s*hi\s+medi\b/i;

class WhatsAppBot {
  constructor() {
    this.client = null;
    this.isReady = false;
    this.processedMessages = new Set(); // Track processed messages to avoid duplicates
    this.sentMessageIds = new Set();    // Track messages sent by the bot so we can ignore them
  }

  initialize() {
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

  setupEventHandlers() {
    // QR Code generation
    this.client.on('qr', (qr) => {
      console.log('📱 QR Code received, scan with WhatsApp:');
      qrcode.generate(qr, { small: true });
    });

    // Client ready
    this.client.on('ready', () => {
      console.log('✅ WhatsApp Bot is ready!');
      console.log('📱 Bot is now listening for messages...');
      console.log('💡 Tip: The bot only responds when a message begins with "Hi Medi"\n');
      this.isReady = true;
    });

    // Incoming messages from other people
    this.client.on('message', async (message) => {
      console.log('🔔 message event');
      if (message.fromMe) {
        console.log('   ⏭️  Ignoring self message on message event\n');
        return;
      }
      await this.handleMessage(message);
    });

    // Self DMs and outbound messages show up here
    this.client.on('message_create', async (message) => {
      console.log('📝 message_create event. fromMe:', !!message.fromMe);

      // Ignore any message the bot sent programmatically
      const serializedId = message.id && (message.id._serialized || message.id);
      if (serializedId && this.sentMessageIds.has(serializedId)) {
        console.log('   ⏭️  Ignoring bot-sent message (tracked id)\n');
        return;
      }

      // Handle self-authored DMs so you can test by messaging yourself
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
          console.log('   ⚠️  Could not check chat type for message_create:', e.message);
        }
      }
    });

    this.client.on('message_revoke_everyone', async () => {
      console.log('🗑️ Message revoked for everyone');
    });

    // Authentication failure
    this.client.on('auth_failure', (msg) => {
      console.error('❌ Authentication failed:', msg);
      console.log('💡 Please scan the QR code again or check your authentication');
    });

    // Disconnected
    this.client.on('disconnected', (reason) => {
      console.log(`🔌 WhatsApp Bot disconnected: ${reason}`);
      console.log('⏸️  Bot is no longer listening for messages');
      this.isReady = false;
    });

    // Loading screen
    this.client.on('loading_screen', (percent, message) => {
      console.log(`⏳ Loading WhatsApp: ${percent}% - ${message}`);
    });

    // Authenticated
    this.client.on('authenticated', () => {
      console.log('🔐 WhatsApp authentication successful');
    });
  }

  async handleMessage(message) {
    try {
      // Create a unique message ID for duplicate detection
      const messageId =
        (message.id && (message.id._serialized || message.id)) ||
        `${message.from}-${message.timestamp}`;

      // Skip duplicates
      if (this.processedMessages.has(messageId)) {
        console.log(`🔄 Skipping duplicate message: ${messageId}`);
        return;
      }
      this.processedMessages.add(messageId);

      // Clean up old processed messages
      if (this.processedMessages.size > 1000) {
        const oldMessages = Array.from(this.processedMessages).slice(0, 500);
        oldMessages.forEach((id) => this.processedMessages.delete(id));
      }

      // Log basics
      const timestamp = new Date().toLocaleTimeString();
      const messageType = message.type || 'text';
      const body = typeof message.body === 'string' ? message.body : '';

      let contactName = 'Unknown';
      try {
        const fromContact = await message.getContact();
        contactName =
          fromContact.name ||
          fromContact.pushname ||
          fromContact.number ||
          'Unknown';
      } catch (error) {
        console.log(`   ⚠️  Could not fetch contact info: ${error.message}`);
        contactName = 'Unknown Contact';
      }

      console.log(`\n📨 [${timestamp}] Message received:`);
      console.log(`   🆔 Message ID: ${messageId}`);
      console.log(`   👤 From: ${contactName} (${message.from})`);
      console.log(`   📝 Type: ${messageType}`);
      console.log(`   💬 Content: "${body}"`);
      console.log(`   🤖 From me: ${message.fromMe ? 'Yes' : 'No'}`);
      console.log(`   ⏰ Timestamp: ${message.timestamp}`);

      // Only respond if message begins with "Hi Medi"
      if (!HI_MEDI_REGEX.test(body)) {
        console.log('   🚫 Start with "Hi Medi".\n');
        return;
      }

      console.log('   🔄 Processing message...');

      // Get conversation context
      console.log(`   📂 Getting conversation for: ${message.from}`);
      const conversationId = message.from;
      const conversation =
        await conversationManager.getConversation(conversationId);

      // Add user message to conversation
      console.log('   💾 Adding user message to conversation');
      conversation.addMessage('user', body);

      // Generate AI response
      console.log('   🧠 Generating AI response...');
      const aiResponse = await llmService.generateResponse(
        conversation.getMessages(),
        body
      );
      console.log(
        `   ✨ AI response generated: "${aiResponse.substring(0, 50)}${
          aiResponse.length > 50 ? '...' : ''
        }"`
      );

      // Add AI response to conversation
      console.log('   💾 Adding AI response to conversation');
      conversation.addMessage('assistant', aiResponse);

      // Send response back to WhatsApp and record the returned id
      console.log(`   🤖 Generated AI response: "${aiResponse}"`);
      console.log('   📤 Sending response...');
      const sent = await this.sendMessage(message.from, aiResponse);
      if (sent && sent.id && (sent.id._serialized || sent.id)) {
        const sid = sent.id._serialized || sent.id;
        this.sentMessageIds.add(sid);
        // Bound growth
        if (this.sentMessageIds.size > 2000) {
          this.sentMessageIds = new Set(
            Array.from(this.sentMessageIds).slice(-1000)
          );
        }
      }

      const responseTime = new Date().toLocaleTimeString();
      console.log(
        `   ✅ [${responseTime}] Response sent successfully to ${contactName}\n`
      );
    } catch (error) {
      const errorTime = new Date().toLocaleTimeString();
      console.error(
        `\n❌ [${errorTime}] Error handling message from ${message.from}:`
      );
      console.error(`   📝 Original message: "${message.body}"`);
      console.error(`   🚨 Error: ${error.message}`);
      console.error(`   📍 Stack: ${error.stack}\n`);

      // Send error message to user
      const errorMessage =
        "I'm sorry, I encountered an error processing your message. Please try again.";
      console.log('   🔄 Sending error message to user...');
      const sent = await this.sendMessage(message.from, errorMessage);
      if (sent && sent.id && (sent.id._serialized || sent.id)) {
        const sid = sent.id._serialized || sent.id;
        this.sentMessageIds.add(sid);
      }
      console.log('   ✅ Error message sent\n');
    }
  }

  async sendMessage(to, message) {
    try {
      if (!this.isReady) {
        throw new Error('WhatsApp client not ready');
      }
      // sendMessage returns a Message
      const sentMsg = await this.client.sendMessage(to, message);
      return sentMsg;
    } catch (error) {
      console.error('❌ Error sending message:', error);
      throw error;
    }
  }

  async sendTyping(to) {
    try {
      if (!this.isReady) return;
      await this.client.sendStateTyping(to);
    } catch (error) {
      console.error('❌ Error sending typing indicator:', error);
    }
  }

  async stopTyping(to) {
    try {
      if (!this.isReady) return;
      await this.client.clearState();
    } catch (error) {
      console.error('❌ Error stopping typing indicator:', error);
    }
  }

  getStatus() {
    return {
      isReady: this.isReady,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = new WhatsAppBot();
