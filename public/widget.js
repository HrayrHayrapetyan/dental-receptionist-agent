/* AI Dental Receptionist — embeddable chat widget.
 *
 * Clinics add ONE line before </body>:
 *   <script src="https://yourapp.com/widget.js" data-client="clinic-id"></script>
 *
 * Optional data attributes:
 *   data-color="#0a7"          accent color
 *   data-position="left"       "right" (default) | "left"
 *   data-title="Book online"   header text
 *
 * Self-contained: no dependencies, no external CSS. Calls back to the server
 * that served this script (POST /chat), so it works on any clinic domain.
 */
(function () {
  var script = document.currentScript;
  var API = new URL(script.src).origin;
  var practiceId = script.getAttribute('data-client') || 'demo-practice';
  var color = script.getAttribute('data-color') || '#0d6efd';
  var side = script.getAttribute('data-position') === 'left' ? 'left' : 'right';
  var title = script.getAttribute('data-title') || 'Book an appointment';

  var sessionId = null;
  var sending = false;

  // ── Styles ──────────────────────────────────────────────────────────
  var css = `
  .drx-btn{position:fixed;bottom:20px;${side}:20px;width:60px;height:60px;border-radius:50%;
    background:${color};color:#fff;border:none;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);
    font-size:26px;z-index:2147483000;display:flex;align-items:center;justify-content:center}
  .drx-panel{position:fixed;bottom:90px;${side}:20px;width:360px;max-width:calc(100vw - 40px);
    height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:14px;overflow:hidden;
    box-shadow:0 12px 40px rgba(0,0,0,.28);z-index:2147483000;display:none;flex-direction:column;
    font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  .drx-panel.open{display:flex}
  .drx-head{background:${color};color:#fff;padding:14px 16px;font-weight:600;font-size:15px}
  .drx-msgs{flex:1;overflow-y:auto;padding:14px;background:#f6f7f9}
  .drx-row{display:flex;margin-bottom:10px}
  .drx-row.user{justify-content:flex-end}
  .drx-bub{max-width:80%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.4;white-space:pre-wrap}
  .drx-row.agent .drx-bub{background:#fff;border:1px solid #e3e6ea;border-bottom-left-radius:4px}
  .drx-row.user .drx-bub{background:${color};color:#fff;border-bottom-right-radius:4px}
  .drx-foot{display:flex;border-top:1px solid #e3e6ea;padding:8px}
  .drx-foot input{flex:1;border:1px solid #d4d8dd;border-radius:20px;padding:9px 12px;font-size:14px;outline:none}
  .drx-foot button{margin-left:8px;background:${color};color:#fff;border:none;border-radius:20px;padding:0 16px;cursor:pointer;font-size:14px}
  .drx-foot button:disabled{opacity:.5;cursor:default}
  .drx-typing{font-size:13px;color:#888;padding:0 14px 10px}
  `;
  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ── DOM ─────────────────────────────────────────────────────────────
  var btn = el('button', 'drx-btn', '💬');
  var panel = el('div', 'drx-panel');
  panel.innerHTML =
    '<div class="drx-head">' + esc(title) + '</div>' +
    '<div class="drx-msgs"></div>' +
    '<div class="drx-typing" style="display:none">Agent is typing…</div>' +
    '<div class="drx-foot"><input type="text" placeholder="Type your message…" />' +
    '<button>Send</button></div>';
  document.body.appendChild(btn);
  document.body.appendChild(panel);

  var msgs = panel.querySelector('.drx-msgs');
  var typing = panel.querySelector('.drx-typing');
  var input = panel.querySelector('input');
  var sendBtn = panel.querySelector('.drx-foot button');

  // ── Events ──────────────────────────────────────────────────────────
  btn.addEventListener('click', function () {
    panel.classList.toggle('open');
    if (panel.classList.contains('open') && !sessionId) start();
    if (panel.classList.contains('open')) input.focus();
  });
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });

  function start() { post(null); }            // mint session + greeting
  function send() {
    var text = input.value.trim();
    if (!text || sending) return;
    addMsg('user', text);
    input.value = '';
    post(text);
  }

  function post(message) {
    sending = true; sendBtn.disabled = true; typing.style.display = 'block';
    fetch(API + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ practiceId: practiceId, sessionId: sessionId, message: message })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        sessionId = d.sessionId || sessionId;
        if (d.reply) addMsg('agent', d.reply);
        if (d.done) { input.disabled = true; sendBtn.disabled = true; }
      })
      .catch(function () { addMsg('agent', 'Sorry, something went wrong. Please call us during business hours.'); })
      .finally(function () {
        sending = false; if (!input.disabled) sendBtn.disabled = false;
        typing.style.display = 'none'; input.focus();
      });
  }

  function addMsg(who, text) {
    var row = el('div', 'drx-row ' + who);
    row.appendChild(el('div', 'drx-bub', text));
    msgs.appendChild(row);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
})();
