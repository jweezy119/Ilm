"use client";

import { useState } from "react";
import styles from "./page.module.css";

interface Message {
  type: "user" | "assistant";
  content: string;
  sources?: Array<{ chapter: string; verse: string }>;
}

export default function ChatPage() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const question = input.trim();
    if (!question) return;

    setMessages((prev) => [...prev, { type: "user", content: question }]);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
        credentials: "include",
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to get response");
      }

      setMessages((prev) => [
        ...prev,
        {
          type: "assistant",
          content: data.answer,
          sources: data.sources,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles["search-page"]}>
      <div className={styles["hero-panel"]}>
        <h1>Quran AI Assistant</h1>
        <p>Ask questions about the Quran and get intelligent, contextual answers.</p>
      </div>

      <div className={styles["chat-shell"]}>
        <div className={styles["chat-messages"]}>
          {messages.length === 0 && (
            <p className={styles["muted"]}>
              Ask anything about the Quran: meanings, stories, guidance, or specific verses.
            </p>
          )}
          {messages.map((msg, idx) => (
            <div key={idx} className={`${styles["chat-bubble"]} ${styles[`msg-${msg.type}`]}`}>
              <div className={styles["chat-bubble-body"]}>{msg.content}</div>
              {msg.sources && msg.sources.length > 0 && (
                <div className={styles["chat-sources"]}>
                  <strong>Sources:</strong>{" "}
                  {msg.sources.map((s, i) => (
                    <span key={i} className={styles["source-chip"]}>
                      {s.chapter}:{s.verse}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {loading && <div className={`${styles["chat-bubble"]} ${styles["msg-assistant"]}`}>Thinking...</div>}
          {error && <div className={`${styles["chat-bubble"]} ${styles["msg-error"]}`}>{error}</div>}
        </div>

        <div className={styles["chat-input-row"]}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask about mercy, guidance, stories, or any Quran topic..."
          />
          <button onClick={send} disabled={loading || !input.trim()}>
            {loading ? "Processing..." : "Ask"}
          </button>
        </div>
      </div>
    </div>
  );
}
