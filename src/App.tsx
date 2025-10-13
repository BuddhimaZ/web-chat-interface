import { useEffect, useMemo, useRef, useState } from "react";
import { PipecatClient, RTVIEvent } from "@pipecat-ai/client-js";
import type { BotLLMTextData, RTVIMessage } from "@pipecat-ai/client-js";
import {
  PipecatClientProvider,
  usePipecatClient,
} from "@pipecat-ai/client-react";
import { WebSocketTransport, ProtobufFrameSerializer } from "@pipecat-ai/websocket-transport";
import { buildWsUrl, getQueryParam } from "./utils/url";

type ChatMessage = {
  id: string;
  role: "user" | "bot";
  text: string;
  streaming?: boolean;
};

function useConnectionState() {
  const [status, setStatus] = useState<"idle" | "connecting" | "ready" | "error" | "disconnected">("idle");
  const [error, setError] = useState<string | null>(null);
  return { status, setStatus, error, setError } as const;
}

function ChatUI() {
  const pc = usePipecatClient();
  const { status, setStatus, error, setError } = useConnectionState();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const streamBotMsgId = useRef<string | null>(null);

  // Build ws URL from env + query param
  const wsUrlOverride = import.meta.env.VITE_WS_URL as string | undefined;
  const hostBaseUrl = import.meta.env.VITE_HOST_BASE_URL as string | undefined;
  const agentId = getQueryParam("agent_id") ?? undefined;
  const wsUrl = useMemo(() => {
    if (wsUrlOverride) return wsUrlOverride;
    if (!hostBaseUrl || !agentId) return undefined;
    try {
      return buildWsUrl(hostBaseUrl, agentId);
    } catch {
      return undefined;
    }
  }, [wsUrlOverride, hostBaseUrl, agentId]);

  useEffect(() => {
    if (hostBaseUrl) console.log("[pipecat] base URL:", hostBaseUrl);
    if (agentId) console.log("[pipecat] agent_id:", agentId);
    if (wsUrl) console.log("[pipecat] wsUrl:", wsUrl);
  }, [hostBaseUrl, agentId, wsUrl]);

  // Register text handlers once
  useEffect(() => {
    if (!pc) return;

    const onBotLlmText = (data: BotLLMTextData) => {
      const token = typeof data?.text === "string" ? data.text : String(data ?? "");
      if (!streamBotMsgId.current) {
        const id = crypto.randomUUID();
        streamBotMsgId.current = id;
        setMessages((msgs) => [...msgs, { id, role: "bot", text: token, streaming: true }]);
      } else {
        const id = streamBotMsgId.current;
        setMessages((msgs) =>
          msgs.map((m) => (m.id === id ? { ...m, text: m.text + token } : m))
        );
      }
    };

    const onBotTranscript = (data: BotLLMTextData) => {
      const text = typeof data?.text === "string" ? data.text : String(data ?? "");
      // finalize streaming message if exists, else add a new one
      if (streamBotMsgId.current) {
        const id = streamBotMsgId.current;
        streamBotMsgId.current = null;
        setMessages((msgs) =>
          msgs.map((m) => (m.id === id ? { ...m, text, streaming: false } : m))
        );
      } else {
        setMessages((msgs) => [
          ...msgs,
          { id: crypto.randomUUID(), role: "bot", text, streaming: false },
        ]);
      }
    };

    const onError = (msg: RTVIMessage) => {
      // RTVI 'error' messages carry { message, fatal } in data
      const data = (msg as { data?: unknown }).data as { message?: unknown } | undefined;
      const m = typeof data?.message === "string" ? data.message : "Message error";
      setError(m);
    };

    const onConnected = () => {
      console.log("[pipecat] connected to transport");
      setStatus("connecting");
    };
    const onBotReady = () => {
      console.log("[pipecat] bot ready");
      setStatus("ready");
    };
    const onDisconnected = () => {
      console.log("[pipecat] disconnected");
      setStatus("disconnected");
    };

    pc.on(RTVIEvent.BotLlmText, onBotLlmText);
    pc.on(RTVIEvent.BotTranscript, onBotTranscript);
    pc.on(RTVIEvent.Error, onError);
    pc.on(RTVIEvent.Connected, onConnected);
    pc.on(RTVIEvent.BotReady, onBotReady);
    pc.on(RTVIEvent.Disconnected, onDisconnected);

    return () => {
      pc.off?.(RTVIEvent.BotLlmText, onBotLlmText);
      pc.off?.(RTVIEvent.BotTranscript, onBotTranscript);
      pc.off?.(RTVIEvent.Error, onError);
      pc.off?.(RTVIEvent.Connected, onConnected);
      pc.off?.(RTVIEvent.BotReady, onBotReady);
      pc.off?.(RTVIEvent.Disconnected, onDisconnected);
    };
  }, [pc, setError, setStatus]);

  // Auto-connect when wsUrl is ready
  const didInit = useRef(false);
  useEffect(() => {
    if (!pc || !wsUrl || didInit.current) return;
    didInit.current = true;
    let cancelled = false;
    (async () => {
      try {
        setConnecting(true);
        console.log("[pipecat] connecting to", wsUrl);
  await pc.connect({ wsUrl: wsUrl, ws_url: wsUrl });
        if (!cancelled) setStatus("ready");
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[pipecat] connect error:", msg);
          setError(msg || "Failed to connect");
          setStatus("error");
        }
      } finally {
        if (!cancelled) setConnecting(false);
      }
    })();
    return () => {
      cancelled = true;
      pc.disconnect().catch(() => {});
    };
  }, [pc, wsUrl, setError, setStatus]);

  const send = async () => {
    const content = input.trim();
    if (!content) return;
    setMessages((msgs) => [
      ...msgs,
      { id: crypto.randomUUID(), role: "user", text: content },
    ]);
    setInput("");
    if (!pc) return;
    try {
      await pc.sendText(content, { audio_response: false, run_immediately: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "Failed to send message");
    }
  };

  const reconnect = async () => {
    if (!wsUrl) return;
    if (!pc) return;
    try {
      setConnecting(true);
      await pc.disconnect().catch(() => {});
  await pc.connect({ wsUrl: wsUrl, ws_url: wsUrl });
      setStatus("ready");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "Reconnect failed");
      setStatus("error");
    } finally {
      setConnecting(false);
    }
  };

  const canChat = status === "ready" && !connecting;
  const missingEnv = !hostBaseUrl;
  const missingAgent = !agentId;

  return (
    <div className="chat-app">
      <header className="chat-header">
        <div className="brand">
          <span className="logo">💬</span>
          <h1>Pipecat Chat</h1>
        </div>
        <div className={`status ${status}`}>
          <span className="dot" />
          <span className="label">
            {connecting ? "connecting" : status}
          </span>
        </div>
      </header>

      {(missingEnv || missingAgent) && (
        <div className="notice">
          {missingEnv && (
            <p>
              Missing VITE_HOST_BASE_URL. Create a .env file with
              VITE_HOST_BASE_URL=https://your-host
            </p>
          )}
          {missingAgent && (
            <p>
              Missing agent_id in URL. Example: ?agent_id=YOUR_AGENT_ID
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button onClick={() => setError(null)} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}

      <main className="chat-main">
        <div className="notice" style={{marginBottom: 12}}>
          <div><strong>WS override:</strong> {wsUrlOverride ?? <em>none</em>}</div>
          <div><strong>Env base URL:</strong> {hostBaseUrl ?? <em>missing</em>}</div>
          <div><strong>Agent ID:</strong> {agentId ?? <em>missing</em>}</div>
          <div><strong>WS URL:</strong> {wsUrl ?? <em>unavailable</em>}</div>
        </div>
        <ul className="messages">
          {messages.map((m) => (
            <li key={m.id} className={`msg ${m.role}`}>
              <div className="bubble">
                {m.text}
                {m.streaming && <span className="cursor" />}
              </div>
            </li>
          ))}
        </ul>
      </main>

      <footer className="chat-input">
        <div className="controls">
          <button
            className="secondary"
            onClick={reconnect}
            disabled={!wsUrl || connecting}
            title={wsUrl || "No wsUrl"}
          >
            {status === "ready" ? "Reconnect" : "Connect"}
          </button>
        </div>
        <div className="input-row">
          <input
            type="text"
            placeholder={canChat ? "Type your message…" : "Connecting…"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canChat) void send();
              }
            }}
            disabled={!canChat}
          />
          <button className="primary" onClick={send} disabled={!canChat || !input.trim()}>
            Send
          </button>
        </div>
      </footer>
    </div>
  );
}

function App() {
  // Create the client once and provide via context
  const client = useMemo(() => {
    return new PipecatClient({
      transport: new WebSocketTransport({
        serializer: new ProtobufFrameSerializer(),
        recorderSampleRate: 8000,
        playerSampleRate: 8000,
      }),
      enableCam: false,
      enableMic: false,
    });
  }, []);

  return (
    <PipecatClientProvider client={client}>
      <ChatUI />
    </PipecatClientProvider>
  );
}

export default App;
