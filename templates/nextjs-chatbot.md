# Next.js Web3 AI Chatbot Template

Full Next.js 14+ App Router application with ChainGPT AI chatbot integration.

### Project Structure
```
nextjs-chaingpt-chatbot/
├── package.json
├── next.config.js
├── tsconfig.json
├── .env.local.example
├── tailwind.config.ts
├── app/
│   ├── layout.tsx (root layout with metadata)
│   ├── page.tsx (chat interface)
│   ├── api/
│   │   ├── chat/route.ts (POST — streaming chat via Node.js runtime)
│   │   └── history/route.ts (GET — chat history)
│   ├── components/
│   │   ├── ChatWindow.tsx (message list + scroll)
│   │   ├── MessageBubble.tsx (user/bot messages with markdown)
│   │   ├── ChatInput.tsx (input + send button)
│   │   └── LoadingDots.tsx (typing indicator)
│   └── lib/
│       ├── chaingpt.ts (SDK wrapper)
│       └── types.ts
└── README.md
```

### Dependencies
next, react, react-dom, @chaingpt/generalchat, react-markdown, tailwindcss

### Key Implementation
- **app/api/chat/route.ts**: Next.js Route Handler using Node.js runtime (`export const runtime = 'nodejs'`). Accepts POST with { question, sessionId }. Uses GeneralChat.createChatStream(). Returns a ReadableStream via new Response(stream). **Note:** Edge Runtime is not compatible because the ChainGPT SDK relies on Node.js-specific streaming APIs (e.g., Node streams) that are not available in the Edge Runtime environment.
- **app/page.tsx**: Client component with useState for messages, useRef for scroll, fetch to /api/chat with streaming reader
- **ChatWindow.tsx**: Maps messages array, auto-scrolls to bottom, renders markdown in bot messages
- **ChatInput.tsx**: Text input + send button, Enter to send, disabled while streaming
- **lib/chaingpt.ts**: Server-side only SDK initialization, chat and stream functions
- **Styling**: Tailwind CSS, responsive, dark mode support
- **.env.local.example**: CHAINGPT_API_KEY=your_key_here

### Setup
```bash
npx create-next-app@latest my-chatbot --typescript --tailwind --app
cd my-chatbot
npm install @chaingpt/generalchat react-markdown
```
