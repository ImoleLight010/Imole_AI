(() => {
  const $ = (id) => document.getElementById(id);
  const chatEl = $("chat"), welcome = $("welcome"), form = $("form");
  const input = $("input"), sendBtn = $("send"), newChatBtn = $("newChat");
  const authView = $("auth"), authForm = $("authForm"), authTitle = $("authTitle");
  const emailEl = $("email"), passEl = $("password"), authMsg = $("authMsg");
  const authBtn = $("authBtn"), authSwitch = $("authSwitch");
  const drawer = $("drawer"), backdrop = $("backdrop"), menuBtn = $("menu");
  const closeDrawerBtn = $("closeDrawer"), listEl = $("convList");
  const userEmailEl = $("userEmail"), logoutBtn = $("logout");

  const TOKEN_KEY = "imole-token";
  const EMAIL_KEY = "imole-email";

  let token = store("get", TOKEN_KEY) || "";
  let userEmail = store("get", EMAIL_KEY) || "";
  let conversations = [];
  let current = newConversation();
  let busy = false;
  let mode = "login";

  function store(op, key, value) {
    try {
      if (op === "get") return localStorage.getItem(key);
      if (op === "set") return localStorage.setItem(key, value);
      if (op === "del") return localStorage.removeItem(key);
    } catch (e) { /* storage may be blocked */ }
    return null;
  }

  function newConversation() {
    return {
      id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      title: "New chat",
      messages: [],
    };
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

  /* ---------- auth screen ---------- */

  function setMode(m) {
    mode = m;
    const login = m === "login";
    authTitle.textContent = login ? "Log in to IMOLE AI" : "Create your account";
    authBtn.textContent = login ? "Log in" : "Create account";
    authSwitch.textContent = login ? "New here? Create an account" : "Already have an account? Log in";
    passEl.autocomplete = login ? "current-password" : "new-password";
    authMsg.textContent = "";
  }

  function showAuth(message) {
    token = "";
    store("del", TOKEN_KEY);
    closeDrawer();
    authView.hidden = false;
    setMode("login");
    if (message) authMsg.textContent = message;
  }

  authSwitch.addEventListener("click", () => setMode(mode === "login" ? "signup" : "login"));

  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    authMsg.textContent = "";
    authBtn.disabled = true;
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: mode === "login" ? "login" : "signup",
          email: emailEl.value,
          password: passEl.value,
        }),
      });
      let data = {};
      try { data = await res.json(); } catch (err) { /* not JSON */ }
      if (!res.ok) {
        authMsg.textContent =
          res.status === 429
            ? "Too many attempts. Please wait a minute."
            : data.error || "Something went wrong. Try again.";
        return;
      }
      token = data.token;
      userEmail = data.email;
      store("set", TOKEN_KEY, token);
      store("set", EMAIL_KEY, userEmail);
      passEl.value = "";
      await startSession();
    } catch (err) {
      authMsg.textContent = "Network error. Check your connection.";
    } finally {
      authBtn.disabled = false;
    }
  });

  /* ---------- API helper ---------- */

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
    });
    if (res.status === 401) {
      showAuth("Session expired. Please log in again.");
      throw new Error("unauthorized");
    }
    return res;
  }

  /* ---------- history drawer ---------- */

  function openDrawer() {
    renderList();
    drawer.classList.add("open");
    backdrop.hidden = false;
  }
  function closeDrawer() {
    drawer.classList.remove("open");
    backdrop.hidden = true;
  }
  menuBtn.addEventListener("click", openDrawer);
  closeDrawerBtn.addEventListener("click", closeDrawer);
  backdrop.addEventListener("click", closeDrawer);

  function renderList() {
    userEmailEl.textContent = userEmail;
    listEl.innerHTML = "";
    if (!conversations.length) {
      const empty = document.createElement("div");
      empty.className = "conv-empty";
      empty.textContent = "No saved chats yet.";
      listEl.appendChild(empty);
      return;
    }
    conversations.forEach((c) => {
      const row = document.createElement("div");
      row.className = "conv" + (c.id === current.id ? " active" : "");
      const title = document.createElement("button");
      title.className = "title";
      title.type = "button";
      title.textContent = c.title;
      title.addEventListener("click", () => openConversation(c.id));
      const del = document.createElement("button");
      del.className = "del";
      del.type = "button";
      del.setAttribute("aria-label", "Delete chat");
      del.innerHTML = "&times;";
      del.addEventListener("click", () => removeConversation(c.id));
      row.appendChild(title);
      row.appendChild(del);
      listEl.appendChild(row);
    });
  }

  function openConversation(id) {
    if (busy) return;
    const found = conversations.find((c) => c.id === id);
    if (!found) return;
    current = JSON.parse(JSON.stringify(found));
    renderChat();
    closeDrawer();
  }

  async function removeConversation(id) {
    if (busy) return;
    if (!confirm("Delete this chat?")) return;
    try {
      await api("/api/history?id=" + encodeURIComponent(id), { method: "DELETE" });
      conversations = conversations.filter((c) => c.id !== id);
      if (current.id === id) {
        current = newConversation();
        renderChat();
      }
      renderList();
    } catch (err) { /* handled in api() or ignore */ }
  }

  async function saveCurrent() {
    try {
      const res = await api("/api/history", {
        method: "PUT",
        body: JSON.stringify({ conversation: current }),
      });
      if (res.ok) {
        const copy = JSON.parse(JSON.stringify(current));
        conversations = [copy, ...conversations.filter((c) => c.id !== copy.id)];
      }
    } catch (err) { /* ignore; chat still works */ }
  }

  /* ---------- chat ---------- */

  function addMessage(role, text) {
    welcome.style.display = "none";
    const el = document.createElement("div");
    el.className = "msg " + (role === "user" ? "user" : "ai");
    if (role === "user") el.textContent = text;
    else el.innerHTML = format(text);
    chatEl.appendChild(el);
    chatEl.scrollTop = chatEl.scrollHeight;
    return el;
  }

  function renderChat() {
    chatEl.querySelectorAll(".msg").forEach((n) => n.remove());
    welcome.style.display = current.messages.length ? "none" : "";
    current.messages.forEach((m) => addMessage(m.role, m.content));
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

    current.messages.push({ role: "user", content: text });
    if (current.messages.length === 1) current.title = text.slice(0, 40);
    addMessage("user", text);
    input.value = "";
    autosize();
    setBusy(true);

    const aiEl = addMessage("ai", "");
    aiEl.classList.add("typing");
    let reply = "";
    let ok = false;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ messages: current.messages.slice(-12) }),
      });

      if (res.status === 401) {
        showAuth("Session expired. Please log in again.");
        throw new Error("Please log in again.");
      }
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
      current.messages.push({ role: "assistant", content: reply });
      ok = true;
    } catch (err) {
      current.messages.pop();
      if (!current.messages.length) current.title = "New chat";
      aiEl.classList.add("error");
      aiEl.innerHTML = escapeHtml(err.message || "Network error.");
    } finally {
      aiEl.classList.remove("typing");
      setBusy(false);
    }

    if (ok) await saveCurrent();
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
    current = newConversation();
    renderChat();
  });

  logoutBtn.addEventListener("click", () => {
    store("del", EMAIL_KEY);
    conversations = [];
    current = newConversation();
    renderChat();
    showAuth("");
  });

  /* ---------- start ---------- */

  async function startSession() {
    try {
      const res = await api("/api/history");
      const data = res.ok ? await res.json() : { conversations: [] };
      conversations = Array.isArray(data.conversations) ? data.conversations : [];
    } catch (err) {
      if (!token) return;
      conversations = [];
    }
    current = newConversation();
    renderChat();
    renderList();
    authView.hidden = true;
  }

  store("del", "imole-ai-history-v1");

  if (token) startSession();
  else showAuth("");
})();
