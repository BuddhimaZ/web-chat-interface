import { useEffect, useMemo, useRef, useState } from "react";
import { usePipecatChat } from "../hooks/usePipecatChat";
import { buildWsUrl, getQueryParam } from "../utils/url";

function useHostBaseUrl() {
  // In Vite, env vars must be prefixed with VITE_
  const url = import.meta.env.VITE_HOST_BASE_URL as string | undefined;
  return url?.trim() || "";
}

export default function Chat() {
  const baseUrl = useHostBaseUrl();
  const agentId = useMemo(() => getQueryParam("agent_id") ?? "", []);
  const [input, setInput] = useState("");
  const debug = useMemo(() => {
    const q = getQueryParam("debug");
    const env = (import.meta.env.VITE_DEBUG_CHAT as string | undefined)?.toLowerCase();
    return q === "1" || q === "true" || env === "1" || env === "true";
  }, []);

  const wsUrl = useMemo(() => {
    if (!baseUrl || !agentId) return "";
    return buildWsUrl(baseUrl, agentId);
  }, [baseUrl, agentId]);

  const { messages, sendText, connect, disconnect, connected, ready, error, isSending } =
    usePipecatChat({ wsUrl, enableMic: false, debug });

  useEffect(() => {
    if (wsUrl) {
      void connect();
      return () => {
        void disconnect();
      };
    }
  }, [wsUrl, connect, disconnect]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    await sendText(input.trim());
    setInput("");
  };

  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (!baseUrl) {
    return (
      <div className="chat-wrapper">
        <div className="chat-card">
          <h2>Missing configuration</h2>
          <p>
            Please set <code>VITE_HOST_BASE_URL</code> in your environment (e.g., <code>.env</code>
            ).
          </p>
        </div>
      </div>
    );
  }

  if (!agentId) {
    return (
      <div className="chat-wrapper">
        <div className="chat-card">
          <h2>Agent not specified</h2>
          <p>
            Provide an <code>agent_id</code> query parameter in the URL.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-wrapper">
      <div className="chat-container">
        <header className="chat-header">
          <div className="chat-title">Pipecat Agent Chat</div>
          <div className={`chat-status ${connected ? (ready ? "ready" : "connecting") : "disconnected"}`}>
            {connected ? (ready ? "Ready" : "Connected") : "Disconnected"}
          </div>
        </header>

        <div className="chat-messages" aria-live="polite">
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.role}`}>
              <div className="bubble">
                {m.text}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {error && <div className="chat-error">{error}</div>}

        <form className="chat-input-row" onSubmit={onSubmit}>
          <input
            className="chat-input"
            placeholder="Type your message…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!connected || isSending}
            aria-label="Message input"
          />
          <button className="chat-send" type="submit" disabled={!connected || isSending || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
