import { useState, useRef, useEffect } from "react";

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<{role: "user"|"bot", html: string}[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg = input;
    setMessages(prev => [...prev, { role: "user", html: userMsg }]);
    setInput("");
    setLoading(true);

    try {
      // Hit the Express backend route
      const res = await fetch("/api/v1/site/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg }),
      });
      const json = await res.json();
      // Replies arrive already sanitized by the server; error messages are plain text, so escape them.
      const escape = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      setMessages(prev => [...prev, { role: "bot", html: json.data?.reply || escape(json.error?.message || "Sorry, something went wrong. Please try again.") }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: "bot", html: "Connection error." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: "fixed", bottom: "24px", right: "24px", zIndex: 9999 }}>
      {isOpen ? (
        <div style={{ backgroundColor: "white", borderRadius: "16px", boxShadow: "0 10px 25px rgba(0,0,0,0.1)", width: "350px", height: "500px", display: "flex", flexDirection: "column", border: "1px solid #eee", overflow: "hidden" }}>
          {/* Header */}
          <div style={{ backgroundColor: "#2563eb", color: "white", padding: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "bold" }}>Web Search Assistant</h3>
            <button onClick={() => setIsOpen(false)} style={{ background: "none", border: "none", color: "white", cursor: "pointer" }}>
              ✕
            </button>
          </div>
          
          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px", backgroundColor: "#f9fafb", color: "#1f2937", display: "flex", flexDirection: "column", gap: "12px" }}>
            {messages.length === 0 && (
              <p style={{ textAlign: "center", fontSize: "14px", color: "#6b7280", marginTop: "40px" }}>Ask me to search the web for anything!</p>
            )}
            {messages.map((msg, i) => (
              <div key={i} style={{ display: "flex", justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div 
                  style={{
                    maxWidth: "85%", padding: "12px", borderRadius: "12px", fontSize: "14px",
                    ...(msg.role === 'user' 
                      ? { backgroundColor: "#2563eb", color: "white", borderBottomRightRadius: "0" } 
                      : { backgroundColor: "white", border: "1px solid #e5e7eb", borderBottomLeftRadius: "0" })
                  }}
                  dangerouslySetInnerHTML={{ __html: msg.html }}
                />
              </div>
            ))}
            {loading && <p style={{ fontSize: "12px", color: "#6b7280" }}>Searching...</p>}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={sendMessage} style={{ padding: "12px", backgroundColor: "white", borderTop: "1px solid #e5e7eb", display: "flex", gap: "8px" }}>
            <input 
              type="text" 
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Type a search query..." 
              style={{ flex: 1, padding: "8px 16px", border: "1px solid #d1d5db", borderRadius: "9999px", outline: "none", fontSize: "14px", color: "black" }}
            />
            <button type="submit" disabled={loading} style={{ backgroundColor: "#2563eb", color: "white", border: "none", borderRadius: "9999px", width: "36px", height: "36px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              ↑
            </button>
          </form>
        </div>
      ) : (
        <button 
          onClick={() => setIsOpen(true)}
          style={{ backgroundColor: "#2563eb", color: "white", border: "none", borderRadius: "50%", width: "56px", height: "56px", boxShadow: "0 4px 12px rgba(37,99,235,0.4)", cursor: "pointer", fontSize: "24px" }}
        >
          💬
        </button>
      )}
    </div>
  );
}
