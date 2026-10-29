(() => {
  const chatEl = document.getElementById("chat");
  const welcome = document.getElementById("welcome");
  const form = document.getElementById("form");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("send");
  const newChatBtn = document.getElementById("newChat");

  const STORE_KEY = "imole-ai-history-v1";
  let history = load();
  let busy = false;

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch (e) {
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(history.slice(-40)));
    } catch (e) { /* storage may be blocked; ignore */ }
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function format(text) {
    const parts = escapeHtml(text).split("```");
    return parts.map((part, i) => {
      if (i % 2 === 1) {
        const body = part.replace(/^[a-zA-Z0-9+#-]*\n/, "");
        return "<pre><code>" + body.replace(/\n$/, "") + "</code></pre>";
      }
      return part
        .replace(/`([^`\n]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    }).join("");
  }

  function addMessage(role, text, opts = {}) {
    welcome.style.display = "none";
    const el = document.createElement("div");
    el.className = "msg " + (role === "user" ? "user" : "ai") + (opts.error ? " error" : "");
    if (role === "user") el.textContent = text;
    else el.innerHTML = format(text);
    chatEl.appendChild(el);
    chatEl.scrollTop = chatEl.scrollHeight;
    return el;
  }

  function render() {
    chatEl.querySelectorAll(".msg").forEach((n) => n.remove());
    welcome.style.display = history.length ? "none" : "";
    history.forEach((m) => addMessage(m.role, m.content));
  }

  function setBusy(v) {
    busy = v;
    sendBtn.disabled = v;
    input.disabled = v;
    if (!v) input.focus();
  }

  async function ask(text) {
    text = text.trim();
    if (!text || busy) return;

    history.push({ role: "user", content: text });
    addMessage("user", text);
    input.value = "";
    autosize();
    setBusy(true);

    const aiEl = addMessage("ai", "");
    aiEl.classList.add("typing");
    let reply = "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-12) }),
      });

      if (!res.ok) {
        let msg = "Something went wrong. Please try again.";
        try {
          const data = await res.json();
          if (data && data.error) msg = data.error;
        } catch (e) { /* not JSON */ }
        if (res.status === 429) msg = "Too many requests. Please wait a moment and try again.";
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload);
            const delta = json.choices && json.choices[0] && json.choices[0].delta;
            if (delta && delta.content) {
              reply += delta.content;
              aiEl.innerHTML = format(reply);
              chatEl.scrollTop = chatEl.scrollHeight;
            }
          } catch (e) { /* partial chunk; skip */ }
        }
      }

      if (!reply) throw new Error("No response received. Please try again.");
      history.push({ role: "assistant", content: reply });
      save();
    } catch (err) {
      history.pop();
      aiEl.classList.add("error");
      aiEl.innerHTML = escapeHtml(err.message || "Network error.");
    } finally {
      aiEl.classList.remove("typing");
      setBusy(false);
    }
  }

  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 140) + "px";
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    ask(input.value);
  });

  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    const isDesktop = window.matchMedia("(pointer: fine)").matches;
    if (e.key === "Enter" && !e.shiftKey && isDesktop) {
      e.preventDefault();
      ask(input.value);
    }
  });

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => ask(chip.textContent));
  });

  newChatBtn.addEventListener("click", () => {
    if (busy) return;
    history = [];
    save();
    render();
  });

  render();
})();
