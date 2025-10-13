# Web Chat Interface

A minimal React + Vite web app that connects to a Pipecat server hosting a chat agent over WebSocket. It reads the base URL from environment variables and derives ws/wss automatically, and the `agent_id` from the page URL query string.

## Requirements

- Node.js 18+
- Yarn
- Pipecat server exposing WS at:
  - `{HOST_BASE_URL}/api/agent/web/chat/ws/{agent_id}`

## Setup

1. Copy the env file template and set your base URL:

```
copy .env.example .env
```

Edit `.env` and set:

```
VITE_HOST_BASE_URL=https://your-pipecat-server
```

2. Install dependencies:

```
yarn install
```

3. Start the dev server:

```
yarn dev
```

Open the app with an agent id in the URL:

```
http://localhost:5173/?agent_id=YOUR_AGENT_ID
```

## Build

```
yarn build
```

## Notes

- ws/wss is picked based on http/https in `VITE_HOST_BASE_URL`.
- Text chat uses `@pipecat-ai/client-js` with `@pipecat-ai/websocket-transport`.
- Audio is disabled in this sample; you can enable mic by passing `enableMic: true` into `usePipecatChat` in `Chat.tsx`.
- Handshake: On connect, the client immediately sends the RTVI `client-ready` message (version `1.0`). The server should respond with `bot-ready`. The UI can accept typing as soon as transport is connected, but sending text is internally held until `bot-ready` arrives per the RTVI standard.
- Debug logging: enable with `?debug=1` in the URL or set `VITE_DEBUG_CHAT=true` in your env. This prints transport state changes, handshake events, and sendText timing.
