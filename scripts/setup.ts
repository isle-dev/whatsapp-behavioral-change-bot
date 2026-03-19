#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import readline from 'readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

async function setup(): Promise<void> {
  console.log('🚀 WhatsApp Chatbot Setup\n');
  console.log('This script will help you configure your WhatsApp chatbot.\n');

  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const overwrite = await question('⚠️  .env file already exists. Overwrite? (y/N): ');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Setup cancelled.');
      rl.close();
      return;
    }
  }

  console.log('\n📝 Configuration Setup:\n');

  const port = (await question('Server port (default: 3000): ')) || '3000';
  const nodeEnv = (await question('Node environment (default: development): ')) || 'development';

  console.log('\n🔑 OpenAI Configuration:');
  const openaiKey = await question('OpenAI API Key: ');
  const openaiModel = (await question('OpenAI Model (default: gpt-3.5-turbo): ')) || 'gpt-3.5-turbo';

  console.log('\n📱 WhatsApp Business API Configuration (optional):');
  const whatsappToken = await question('WhatsApp Access Token: ');
  const whatsappPhoneId = await question('WhatsApp Phone Number ID: ');
  const whatsappVerifyToken = await question('WhatsApp Verify Token: ');

  console.log('\n🔧 Admin Configuration:');
  const adminKey = (await question('Admin API Key (for admin routes): ')) || 'admin-secret-key';

  const envContent = `# Server Configuration
PORT=${port}
NODE_ENV=${nodeEnv}

# OpenAI Configuration
OPENAI_API_KEY=${openaiKey}
OPENAI_MODEL=${openaiModel}

# WhatsApp Business API Configuration
WHATSAPP_ACCESS_TOKEN=${whatsappToken}
WHATSAPP_PHONE_NUMBER_ID=${whatsappPhoneId}
WHATSAPP_VERIFY_TOKEN=${whatsappVerifyToken}

# Admin API Key
ADMIN_API_KEY=${adminKey}
`;

  try {
    fs.writeFileSync(envPath, envContent);
    console.log('\n✅ Configuration saved to .env file!');
  } catch (error) {
    console.error('\n❌ Error saving configuration:', (error as Error).message);
    rl.close();
    return;
  }

  console.log('\n📦 Next Steps:');
  console.log('1. Install dependencies: pnpm install');
  console.log('2. Build the project: pnpm run build');
  console.log('3. Start the server: pnpm start');
  console.log('4. Or run in dev mode: pnpm dev');

  if (whatsappToken && whatsappPhoneId) {
    console.log('\n📱 WhatsApp Business API Mode:');
    console.log('- Configure your webhook URL in Meta Developer Console');
    console.log('- Webhook URL: https://your-domain.com/webhook');
    console.log('- Verify Token: ' + whatsappVerifyToken);
  } else {
    console.log('\n📱 WhatsApp Web Mode:');
    console.log('- Set USE_WHATSAPP=true in .env to enable QR code mode');
    console.log('- The bot will show a QR code when started');
    console.log('- Scan it with your WhatsApp mobile app');
  }

  console.log('\n🎉 Setup complete! Happy chatting!');
  rl.close();
}

process.on('unhandledRejection', (error) => {
  console.error('❌ Setup failed:', error);
  process.exit(1);
});

setup();
