import { useEffect, useMemo, useRef, useState } from "react";
import { usePipecatChat } from "../hooks/usePipecatChat";

export default function Chat() {
  const {
    ready,
    status,
    error,
    botVersion,
    messages,
    sendText,
    reconnect,
    disconnect,
    wsUrl,
    agentId,
    baseUrl,
  } = usePipecatChat();

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const statusText = useMemo(() => {
    if (error) return `Error`;
    if (status === "ready") return `Ready`;
    if (status === "connected") return `Connected`;
    if (status === "connecting") return `Connecting…`;
    if (status === "disconnected") return `Disconnected`;
    return "Idle";
  }, [status, error]);

  useEffect(() => {
    // Auto scroll to bottom on new messages
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const onSend = async () => {
    const text = input.trim();
    if (!text) return;
    await sendText(text);
    setInput("");
  };

  const showConnect = !ready && (status === "idle" || status === "disconnected" || status === "error");

  return (
    <div className="app">
      <header className="header">
        <div className="title">Pipecat Chat</div>
        <div className={`status ${ready ? "ready" : ""} ${error ? "error" : ""}`}>
          {statusText}{botVersion ? ` · RTVI v${botVersion}` : ""}
        </div>
      </header>

      <div className="container">
        <div className="chat" ref={scrollRef}>
          {!agentId || !baseUrl ? (
            <div className="error">
              {(function () {
                if (!baseUrl) {
                  return (
                    <div>
                      Missing VITE_HOST_BASE_URL. Create <code>.env.local</code> with <code>VITE_HOST_BASE_URL</code>.
                      <div className="hint">Example: VITE_HOST_BASE_URL=http://localhost:3000</div>
                    </div>
                  );
                }
                if (!agentId) {
                  return (
                    <div>
                      Missing agent_id query parameter.
                      <div className="hint">Open this page with ?agent_id=YOUR_AGENT_ID</div>
                    </div>
                  );
                }
              })()}
            </div>
          ) : null}

          {error ? <div className="error">{error}</div> : null}

          <div className="messages">
            {messages.length === 0 ? (
              <div className="empty">No messages yet. Say hi to your agent!</div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`msg ${m.role === "user" ? "user" : "bot"}`}>
                  <div className="bubble">
                    <div className="role">{m.role === "user" ? "You" : "Agent"}</div>
                    <div>{m.text}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="composer">
        <div className="composer-inner">
          <input
            className="input"
            placeholder="Type your message…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            disabled={!ready}
          />
          <button className="button" onClick={onSend} disabled={!ready || !input.trim()}>
            Send
          </button>
          {ready ? (
            <button className="button secondary" onClick={() => disconnect()}>Disconnect</button>
          ) : (
            <button className="button secondary" onClick={() => reconnect()} disabled={!wsUrl || status === "connecting"}>
              {status === "connecting" ? "Connecting…" : showConnect ? "Connect" : "Reconnect"}
            </button>
          )}
        </div>
        <div className="footer-note">
          Using: {baseUrl ? new URL(baseUrl).origin : "(no base URL)"} · WS: {wsUrl ?? "(n/a)"}
        </div>
      </div>
    </div>
  );
}
