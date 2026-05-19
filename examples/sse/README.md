# SSE streaming demo

Wraps ChainGPT's `GeneralChat.createChatStream(...)` in a minimal Server-Sent Events endpoint a browser EventSource can consume directly.

## Run

```bash
cd examples/sse
npm init -y
npm install express @chaingpt/generalchat dotenv
CHAINGPT_API_KEY=… node server.js
```

Then open <http://localhost:3000/client.html>, type a question, press Enter. The answer streams back token-by-token.

## How it works

- `server.js` exposes `GET /sse/chat?q=…` and serves the page from `.`.
- `client.html` opens `new EventSource('/sse/chat?q=…')` and renders each `token` event into the page.
- Three named events: `token` (each chunk), `done` (stream ended cleanly), `error` (anything went wrong).
- A 15s heartbeat (`: keep-alive`) prevents intermediate proxies from idling out.

## Wire-format reminder

SSE messages are newline-delimited text:

```
event: token
data: chunk of text

event: token
data: another chunk

event: done
data: ok
```

Two consecutive newlines (`\n\n`) terminate each message. Multi-line content uses repeated `data:` lines; `server.js` handles that for you.

## Why SSE over WebSockets

For one-direction server-to-client streaming, SSE wins:

- Works over plain HTTP — no WS upgrade, no proxy fuss.
- Auto-reconnects in the browser (browsers send `Last-Event-ID` on reconnect; this demo doesn't use it but the surface is free).
- Works through every CDN that supports HTTP/2.
- Strictly simpler client code (no message framing, no ping/pong).

If you need bidirectional, switch to WS or WebTransport.
