/**
 * ChainGPT SSE streaming demo — Node server.
 *
 * Wraps `GeneralChat.createChatStream(...)` in a tiny Server-Sent Events
 * endpoint a browser EventSource can consume directly. Useful when you
 * want the streaming UX in a static front-end without writing any wallet
 * code.
 *
 * Run:
 *   cd examples/sse
 *   npm init -y
 *   npm install express @chaingpt/generalchat dotenv
 *   CHAINGPT_API_KEY=… node server.js
 *
 * Then open client.html in a browser. The page asks a question and
 * renders the streamed response token-by-token via EventSource.
 *
 * SSE framing reminder:
 *   data: <text>\n\n
 * is the on-the-wire format. Multi-line content uses repeated `data:` lines.
 * The client treats every double-newline as one "message" event. We send
 * one message per chunk emitted by createChatStream.
 */

import 'dotenv/config';
import express from 'express';
import { GeneralChat } from '@chaingpt/generalchat';

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.CHAINGPT_API_KEY;
if (!API_KEY) {
  console.error('CHAINGPT_API_KEY not set. Add it to .env or your shell.');
  process.exit(1);
}

const chat = new GeneralChat({ apiKey: API_KEY });
const app = express();

// Static file serving so client.html can be loaded from the same origin.
app.use(express.static('.'));

/**
 * GET /sse/chat?q=...
 *
 * Streams the answer back as SSE. The client opens this URL with
 * `new EventSource('/sse/chat?q=' + encodeURIComponent(question))`.
 */
app.get('/sse/chat', async (req, res) => {
  const question = String(req.query.q ?? '').trim();
  if (!question) {
    res.status(400).json({ error: 'q (question) required' });
    return;
  }

  // SSE response headers
  res.set({
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // Disable buffering on common reverse proxies (nginx, etc.):
    'x-accel-buffering': 'no',
  });
  res.flushHeaders();

  const send = (event, data) => {
    // SSE: every line of `data` is prefixed with "data: "; messages end with "\n\n".
    const dataLines = String(data).split('\n').map((l) => `data: ${l}`).join('\n');
    res.write(`event: ${event}\n${dataLines}\n\n`);
  };

  // Heartbeat every 15s prevents intermediate proxies from idling the connection out.
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);
  req.on('close', () => clearInterval(heartbeat));

  try {
    const stream = await chat.createChatStream({ question, chatHistory: 'off' });
    stream.on('data', (chunk) => send('token', chunk.toString()));
    stream.on('end', () => {
      send('done', 'ok');
      clearInterval(heartbeat);
      res.end();
    });
    stream.on('error', (err) => {
      send('error', err?.message ?? String(err));
      clearInterval(heartbeat);
      res.end();
    });
  } catch (err) {
    send('error', err?.message ?? String(err));
    clearInterval(heartbeat);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`SSE chat demo listening on http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT}/client.html to try it.`);
});
