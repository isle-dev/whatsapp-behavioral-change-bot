declare module 'whatsapp-web.js' {
  export interface MessageId {
    _serialized: string;
    id: string;
    fromMe: boolean;
  }

  export interface Contact {
    name?: string;
    pushname?: string;
    number?: string;
  }

  export interface Chat {
    isGroup: boolean;
    isStatus: boolean;
  }

  export interface Message {
    id: MessageId;
    fromMe: boolean;
    from: string;
    body: string;
    type: string;
    timestamp: number;
    getChat(): Promise<Chat>;
    getContact(): Promise<Contact>;
  }

  export interface ClientOptions {
    authStrategy?: LocalAuth;
    puppeteer?: Record<string, unknown>;
  }

  export class LocalAuth {
    constructor(options?: Record<string, unknown>);
  }

  export class Client {
    constructor(options: ClientOptions);
    initialize(): void;
    on(event: 'qr', handler: (qr: string) => void): this;
    on(event: 'ready', handler: () => void): this;
    on(event: 'message', handler: (message: Message) => void): this;
    on(event: 'message_create', handler: (message: Message) => void): this;
    on(event: 'message_revoke_everyone', handler: () => void): this;
    on(event: 'auth_failure', handler: (msg: string) => void): this;
    on(event: 'disconnected', handler: (reason: string) => void): this;
    on(event: 'loading_screen', handler: (percent: number, message: string) => void): this;
    on(event: 'authenticated', handler: () => void): this;
    on(event: string, handler: (...args: unknown[]) => void): this;
    sendMessage(to: string, content: string): Promise<Message>;
    sendStateTyping(to: string): Promise<void>;
    clearState(): Promise<void>;
  }
}
