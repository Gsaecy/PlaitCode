"use strict";var H=require("node:crypto"),Oe=require("node:http");var R=require("node:fs/promises"),ne=require("node:path"),F=class{constructor(e={}){this.options=e;this.maxBytes=Math.max(4*1024,e.maxBytes??20*1024*1024),this.keep=Math.max(1,Math.min(e.keep??3,20)),this.includeIp=e.includeIp??!0}options;maxBytes;keep;includeIp;queue=Promise.resolve();written=0;record(e){let n={ts:(this.options.now?.()??new Date).toISOString(),event:e.event,...e.channel?{channel:e.channel}:{},...e.device?{device:e.device}:{},...e.message?{message:e.message}:{},...e.ip&&this.includeIp?{ip:e.ip}:{},...typeof e.bytes=="number"?{bytes:e.bytes}:{},...e.detail?{detail:e.detail}:{}},r=`${JSON.stringify(n)}
`;try{this.options.sink?.(r.trimEnd())}catch{}let a=this.options.path;a&&(this.queue=this.queue.then(()=>this.append(a,r)).catch(()=>{}))}async flush(){await this.queue.catch(()=>{})}async append(e,n){let r=Buffer.byteLength(n);this.written===0&&(this.written=await(0,R.stat)(e).then(a=>a.size).catch(()=>0)),this.written+r>this.maxBytes&&(await this.rotate(e),this.written=0),await(0,R.mkdir)((0,ne.dirname)(e),{recursive:!0}).catch(()=>{}),await(0,R.appendFile)(e,n,"utf8"),this.written+=r}async rotate(e){for(let n=this.keep;n>=1;n-=1){let r=n===1?e:`${e}.${n-1}`,a=`${e}.${n}`;await(0,R.rename)(r,a).catch(()=>{})}}};var re="plaitcode/channel/1:",ie="plaitcode/relay/1:",oe="plaitcode/enc/1:";function ae(t){let e=t.relayHost.replace(/[<>&"]/g,""),n=t.sessionAuth===!0;return`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f1115">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:">
<title>PlaitCode \xB7 \u56E2\u961F\u7FA4</title>
<style>
  :root { --bg:#0f1115; --panel:#171a21; --panel2:#1e222b; --line:#2a2f3a; --text:#e5e7eb; --muted:#9aa3b2;
    --brand:#4c9aff; --warn:#f0b429; --ok:#34d399; --bad:#f87171; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html, body { margin:0; height:100%; background:var(--bg); color:var(--text);
    font:16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  body { display:flex; flex-direction:column; }
  header { padding:12px 14px; background:var(--panel); border-bottom:1px solid var(--line);
    display:flex; align-items:center; gap:8px; position:sticky; top:0; z-index:5; }
  header .dot { width:8px; height:8px; border-radius:50%; background:var(--muted); }
  header .dot.on { background:var(--ok); box-shadow:0 0 0 3px rgba(52,211,153,.15); }
  header .title { font-weight:600; font-size:15px; }
  header .meta { margin-left:auto; font-size:12px; color:var(--muted); }
  main { flex:1; overflow-y:auto; padding:12px 12px 20px; -webkit-overflow-scrolling:touch; }
  .banner { margin:0 0 12px; padding:10px 12px; border-radius:12px; font-size:14px;
    background:rgba(240,180,41,.12); border:1px solid rgba(240,180,41,.45); color:#f7d68a; }
  .banner b { display:block; margin-bottom:4px; color:var(--warn); }
  .msg { display:flex; margin-bottom:12px; }
  .msg.user { justify-content:flex-end; }
  .bubble { max-width:86%; padding:9px 12px; border-radius:14px; background:var(--panel2);
    border:1px solid var(--line); white-space:pre-wrap; word-break:break-word; font-size:15px; }
  .msg.user .bubble { background:#1d3a5f; border-color:#2a4f7d; }
  .meta-line { font-size:11px; color:var(--muted); margin-bottom:4px; display:flex; gap:6px; align-items:center; }
  .msg.user .meta-line { justify-content:flex-end; }
  .tag { padding:1px 6px; border-radius:6px; font-size:11px; border:1px solid var(--line); color:var(--muted); }
  .tag.question { color:var(--warn); border-color:rgba(240,180,41,.5); }
  .tag.result { color:var(--ok); border-color:rgba(52,211,153,.5); }
  .tag.requirement { color:var(--brand); border-color:rgba(76,154,255,.5); }
  footer { padding:10px 12px calc(10px + env(safe-area-inset-bottom)); background:var(--panel);
    border-top:1px solid var(--line); display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap; }
  .assign { flex:1 0 100%; display:flex; gap:6px; overflow-x:auto; align-items:center; font-size:12px; color:var(--muted); }
  .assign .label { flex:0 0 auto; font-size:11px; }
  .assign .chip { padding:5px 10px; border-radius:999px; border:1px solid var(--line); color:var(--muted);
    background:var(--panel2); font-size:12px; white-space:nowrap; flex:0 0 auto; }
  .assign .chip.on { border-color:var(--brand); color:var(--brand); }
  .board { padding:8px 12px; border-bottom:1px solid var(--line); background:var(--panel2); }
  .board .head { font-size:11px; color:var(--muted); margin-bottom:6px; }
  .board .cols { display:flex; gap:8px; overflow-x:auto; }
  .board .col { flex:0 0 auto; min-width:132px; }
  .board .col b { display:block; font-size:10px; color:var(--muted); margin-bottom:4px; }
  .board .card { border:1px solid var(--line); border-radius:10px; padding:6px 8px; margin-bottom:6px;
    background:var(--panel); font-size:12px; line-height:1.35; }
  .board .card .m { font-size:10px; color:var(--muted); margin-top:2px; }
  textarea { flex:1; resize:none; min-height:42px; max-height:120px; padding:10px 12px; border-radius:12px;
    background:var(--panel2); color:var(--text); border:1px solid var(--line); font:inherit; font-size:15px; }
  button { padding:10px 12px; border-radius:10px; font-size:15px; border:1px solid var(--line);
    background:var(--panel2); color:var(--text); font-weight:600; }
  button.primary { background:var(--brand); border-color:var(--brand); color:#06121f; }
  footer button { flex:0 0 68px; }
  footer button:disabled { opacity:.5; }
  .empty { color:var(--muted); text-align:center; font-size:14px; padding:40px 20px; }
  .join { padding:28px 18px; }
  .join h1 { font-size:18px; margin:0 0 6px; }
  .join p { color:var(--muted); font-size:14px; margin:0 0 18px; }
  .join input { width:100%; padding:13px; border-radius:12px; background:var(--panel2); color:var(--text);
    border:1px solid var(--line); font-size:15px; }
  .join button { width:100%; margin-top:12px; padding:13px; }
  .err { color:var(--bad); font-size:13px; min-height:20px; margin-top:10px; text-align:center; }
  .hint { color:var(--muted); font-size:12px; margin-top:14px; line-height:1.6; }
</style>
</head>
<body>
<header>
  <span class="dot" id="dot"></span>
  <span class="title">PlaitCode \xB7 \u56E2\u961F\u7FA4</span>
  <span class="meta" id="meta">${e}</span>
</header>
<div class="board" id="board" style="display:none"></div>
<main id="main"><div class="empty">\u6B63\u5728\u8BFB\u53D6\u9891\u9053\u2026</div></main>
<footer id="footer" style="display:none">
  <div class="assign" id="assign"></div>
  <textarea id="input" rows="1" placeholder="\u4EE5\u7532\u65B9\u8EAB\u4EFD\u8BF4\u4E00\u53E5\u8BDD\uFF08Enter \u53D1\u9001\uFF09"></textarea>
  <button class="primary" id="send">\u53D1\u9001</button>
</footer>
<script>
(function () {
  var KEY_STORE = 'plaitcode.relay.key';
  var SESSION_AUTH = ${n?"true":"false"};
  var PHASES = { requirement:'\u9700\u6C42', analysis:'\u89E3\u6790', question:'\u8FFD\u95EE', answer:'\u56DE\u590D', confirm:'\u786E\u8BA4', progress:'\u8FDB\u5EA6', result:'\u7ED3\u679C' };
  var main = document.getElementById('main');
  var footer = document.getElementById('footer');
  var input = document.getElementById('input');
  var sendBtn = document.getElementById('send');
  var dot = document.getElementById('dot');
  var meta = document.getElementById('meta');

  var secret = null, keys = null, deviceId = null, since = 0, busy = false, signature = '';
  var devices = [], chosen = '';

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function say(text) { main.innerHTML = ''; var box = el('div', 'empty', text); main.appendChild(box); }

  function b64(bytes) { var s = ''; var view = new Uint8Array(bytes); for (var i = 0; i < view.length; i += 1) s += String.fromCharCode(view[i]); return btoa(s); }
  function unb64(text) { var s = atob(text); var out = new Uint8Array(s.length); for (var i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i); return out; }
  function b64url(bytes) { return b64(bytes).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, ''); }
  function hex(bytes) { var s = ''; var view = new Uint8Array(bytes); for (var i = 0; i < view.length; i += 1) s += ('0' + view[i].toString(16)).slice(-2); return s; }

  var encoder = new TextEncoder();

  function digest(prefix) {
    return crypto.subtle.digest('SHA-256', encoder.encode(prefix + secret)).then(function (buf) { return buf; });
  }

  function deriveKeys() {
    return Promise.all([digest('${re}'), digest('${ie}'), digest('${oe}')])
      .then(function (parts) {
        return crypto.subtle.importKey('raw', parts[2], 'AES-GCM', false, ['encrypt', 'decrypt'])
          .then(function (key) {
            return { channel: hex(parts[0]).slice(0, 32), relay: b64url(parts[1]), enc: key };
          });
      });
  }

  function seal(id, plaintext) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.encrypt(
      { name:'AES-GCM', iv: iv, additionalData: encoder.encode(keys.channel + ':' + id), tagLength:128 },
      keys.enc, encoder.encode(plaintext)
    ).then(function (ct) { return { iv: b64(iv), ct: b64(ct) }; });
  }

  function open(id, envelope) {
    return crypto.subtle.decrypt(
      { name:'AES-GCM', iv: unb64(envelope.iv), additionalData: encoder.encode(keys.channel + ':' + id), tagLength:128 },
      keys.enc, unb64(envelope.ct)
    ).then(function (buf) { return JSON.parse(new TextDecoder().decode(buf)); }).catch(function () { return null; });
  }

  function authHeaders() {
    return SESSION_AUTH ? {} : { authorization: 'Bearer ' + keys.relay };
  }

  function post(path, body) {
    return fetch(path, {
      method:'POST', credentials:'same-origin',
      headers: Object.assign({ 'content-type':'application/json' }, authHeaders()),
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().catch(function () { return {}; }); });
  }

  function presence() {
    return post('/v1/presence', {
      channel: keys.channel,
      device: { id: deviceId, name: '\u624B\u673A \xB7 \u6D4F\u89C8\u5668', platform: 'android', project: 'mobile' }
    }).then(function (result) {
      if (Array.isArray(result.devices)) {
        meta.textContent = (result.devices.length || 1) + ' \u53F0\u8BBE\u5907\u5728\u7EBF';
        // \u624B\u673A\u53EA\u662F"\u7532\u65B9"\uFF0C\u771F\u6B63\u7684\u6267\u884C\u8005\u662F\u90A3\u4E9B\u7535\u8111\uFF1A\u628A\u5B83\u4EEC\u5217\u51FA\u6765\u4F9B\u6307\u6D3E
        devices = result.devices.filter(function (item) {
          return item && item.id && item.platform !== 'android';
        });
        if (chosen && !devices.some(function (item) { return item.id === chosen; })) chosen = '';
        renderAssign();
        renderBoard();
      }
    }).catch(function () {});
  }

  function renderAssign() {
    var box = document.getElementById('assign');
    box.textContent = '';
    var label = el('span', 'label', '\u7531\u8C01\u6267\u884C');
    box.appendChild(label);
    function chip(id, text) {
      var node = el('button', 'chip' + (chosen === id ? ' on' : ''), text);
      node.type = 'button';
      node.onclick = function () { chosen = id; renderAssign(); };
      box.appendChild(node);
    }
    chip('', '\u81EA\u52A8\uFF08\u8C01\u5728\u7EBF\u8C01\u505A\uFF09');
    devices.forEach(function (device) {
      var name = device.name || device.id;
      chip(device.id, name + (device.project ? ' \xB7 ' + device.project : ''));
    });
  }

  function projectOf(id) {
    var hit = devices.filter(function (item) { return item.id === id; })[0];
    return hit && hit.project ? hit.project : '';
  }

  var STATUS_LABEL = { question:'\u7B49\u4F60\u56DE\u590D', running:'\u8FDB\u884C\u4E2D', open:'\u5F85\u63A5', done:'\u5DF2\u5B8C\u6210' };
  var STATUS_ORDER = ['question', 'running', 'open', 'done'];
  function boardFor(list) {
    var tasks = {}, order = [];
    list.slice().sort(function (a, b) { return (a.at || 0) - (b.at || 0); }).forEach(function (m) {
      var id = m.requirementId || m.id;
      if (!id) return;
      if (m.author === 'user' && m.phase === 'requirement') {
        if (!tasks[id]) {
          tasks[id] = { id:id, title:(m.body || '').split('\\n')[0].slice(0, 48), project:m.project || '', assignee:m.assignee || '', status:'open', line:'' };
          order.push(id);
        } else {
          if (m.project) tasks[id].project = m.project;
          if (m.assignee) tasks[id].assignee = m.assignee;
        }
        return;
      }
      var task = tasks[id];
      if (!task) return;
      if (m.phase === 'question') { task.status = 'question'; task.line = m.body; }
      else if (m.phase === 'result') { task.status = 'done'; task.line = m.body; }
      else if (task.status !== 'done') { task.status = 'running'; task.line = m.body; }
    });
    return order.map(function (id) { return tasks[id]; });
  }

  function renderBoard() {
    var box = document.getElementById('board');
    var tasks = boardFor(messages);
    if (!tasks.length) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    box.innerHTML = '';
    box.appendChild(el('div', 'head', '\u4EFB\u52A1\u770B\u677F \xB7 ' + tasks.length + ' \u6761'));
    var cols = el('div', 'cols');
    STATUS_ORDER.forEach(function (status) {
      var group = tasks.filter(function (task) { return task.status === status; });
      if (!group.length) return;
      var col = el('div', 'col');
      col.appendChild(el('b', null, STATUS_LABEL[status] + ' \xB7 ' + group.length));
      group.forEach(function (task) {
        var card = el('div', 'card');
        card.appendChild(el('div', null, task.title));
        var who = task.assignee
          ? (devices.filter(function (item) { return item.id === task.assignee; })[0] || {}).name || '\u5DF2\u6307\u6D3E'
          : '\u672A\u6307\u6D3E';
        var metaLine = [task.project, who].filter(Boolean).join(' \xB7 ');
        card.appendChild(el('div', 'm', metaLine));
        if (task.line) card.appendChild(el('div', 'm', String(task.line).slice(0, 60)));
        col.appendChild(card);
      });
      cols.appendChild(col);
    });
    box.appendChild(cols);
  }

  function render(state) {
    dot.className = 'dot' + (state.connected ? ' on' : '');
    renderBoard();
    var next = JSON.stringify([state.messages, state.question]);
    if (next === signature) return;
    signature = next;
    var atBottom = main.scrollHeight - main.scrollTop - main.clientHeight < 80;
    main.innerHTML = '';
    if (state.question) {
      var banner = el('div', 'banner');
      banner.appendChild(el('b', null, '\u4E59\u65B9\u5728\u7B49\u4F60\u56DE\u7B54'));
      banner.appendChild(el('span', null, state.question));
      main.appendChild(banner);
    }
    state.messages.forEach(function (message) {
      var mine = message.author === 'user';
      var wrap = el('div', 'msg' + (mine ? ' user' : ''));
      var bubble = el('div', 'bubble');
      var line = el('div', 'meta-line');
      line.appendChild(el('span', 'tag ' + message.phase, PHASES[message.phase] || message.phase));
      var who = mine ? '\u4F60' : ((message.from && message.from.name) || '\u4E59\u65B9');
      var time = new Date(message.at || Date.now());
      line.appendChild(el('span', null, who + ' \xB7 ' + ('0' + time.getHours()).slice(-2) + ':' + ('0' + time.getMinutes()).slice(-2)));
      bubble.appendChild(line);
      bubble.appendChild(el('div', null, message.body));
      wrap.appendChild(bubble);
      main.appendChild(wrap);
    });
    if (!main.childNodes.length) main.appendChild(el('div', 'empty', '\u8FD8\u6CA1\u6709\u53D1\u8A00\u3002\u8BF4\u4E00\u53E5\u9700\u6C42\uFF0C\u4E24\u53F0\u7535\u8111\u4E0A\u7684\u4E59\u65B9\u90FD\u4F1A\u6536\u5230\u3002'));
    if (atBottom) main.scrollTop = main.scrollHeight;
  }

  var messages = [];
  function questionFor(list) {
    var answered = {};
    for (var i = list.length - 1; i >= 0; i -= 1) {
      var m = list[i];
      if (m.author === 'user') answered[m.requirementId] = true;
      else if (m.phase === 'question' && !answered[m.requirementId]) return m.body;
    }
    return '';
  }

  function poll() {
    if (busy) return;
    busy = true;
    var url = '/v1/poll?channel=' + encodeURIComponent(keys.channel) + '&since=' + since + '&wait=20';
    fetch(url, { credentials:'same-origin', headers: authHeaders() })
      .then(function (r) {
        if (r.status === 401) throw new Error(SESSION_AUTH ? '\u767B\u5F55\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u7528\u98DE\u4E66\u767B\u5F55' : '\u9700\u8981\u767B\u5F55\u624D\u80FD\u770B\u8FD9\u4E2A\u9891\u9053');
        if (r.status === 403) throw new Error(SESSION_AUTH ? '\u6CA1\u6709\u8FD9\u4E2A\u9891\u9053\u7684\u6743\u9650\uFF08\u627E\u7BA1\u7406\u5458\u6388\u6743\u8BBE\u5907\uFF09' : '\u9891\u9053\u5BC6\u94A5\u4E0D\u5BF9');
        return r.json();
      })
      .then(function (result) {
        var incoming = Array.isArray(result.messages) ? result.messages : [];
        if (typeof result.seq === 'number' && result.seq > since) since = result.seq;
        var chain = Promise.resolve();
        incoming.forEach(function (entry) {
          if (!entry || typeof entry.id !== 'string') return;
          if (entry.from === deviceId) return;
          chain = chain.then(function () {
            return open(entry.id, entry.envelope).then(function (message) {
              if (!message || message.kind !== 'group') return;
              if (messages.some(function (item) { return item.id === message.id; })) return;
              messages.push(message);
              if (messages.length > 200) messages = messages.slice(-200);
            });
          });
        });
        return chain;
      })
      .then(function () {
        dot.className = 'dot on';
        render({ connected:true, messages: messages, question: questionFor(messages) });
      })
      .catch(function () { dot.className = 'dot'; })
      .finally(function () { busy = false; });
  }

  function submit() {
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendBtn.disabled = true;
    var id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var message = {
      kind: 'group', id: id, author: 'user', phase: 'requirement', body: text, requirementId: id, at: Date.now(),
      from: { id: deviceId, name: '\u624B\u673A \xB7 \u6D4F\u89C8\u5668', platform: 'android', project: 'mobile', version: 'web' }
    };
    // \u6307\u6D3E\uFF1A\u8BF4\u6E05\u8BA9\u54EA\u53F0\u7535\u8111\u505A\uFF0C\u907F\u514D\u4E24\u53F0\u90FD\u8DD1\u4E00\u904D\u3001\u6539\u52A8\u4E92\u76F8\u8986\u76D6
    if (chosen) {
      message.assignee = chosen;
      var targetProject = projectOf(chosen);
      if (targetProject) message.project = targetProject;
    }
    seal(id, JSON.stringify(message))
      .then(function (envelope) { return post('/v1/publish', { channel: keys.channel, id: id, from: deviceId, envelope: envelope }); })
      .then(function (result) {
        if (!result.ok) { input.value = text; alert(result.error || '\u6CA1\u53D1\u51FA\u53BB'); return; }
        messages.push(message);
        signature = '';
        render({ connected:true, messages: messages, question: questionFor(messages) });
      })
      .catch(function () { input.value = text; alert('\u7F51\u7EDC\u6CA1\u8FDE\u4E0A'); })
      .finally(function () { sendBtn.disabled = false; input.focus(); });
  }

  sendBtn.addEventListener('click', submit);
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
  });

  function joinForm(errorText) {
    footer.style.display = 'none';
    main.innerHTML = '';
    var form = document.createElement('form');
    form.className = 'join';
    form.appendChild(el('h1', null, '\u52A0\u5165\u56E2\u961F\u7FA4'));
    form.appendChild(el('p', null, '\u628A\u7535\u8111\u4E0A\u300CPlaitCode: \u624B\u673A\u52A0\u5165\u9891\u9053\u300D\u663E\u793A\u7684\u4E8C\u7EF4\u7801\u626B\u4E00\u4E0B\uFF0C\u6216\u7C98\u8D34\u90A3\u4E00\u6574\u6761\u914D\u5BF9\u4FE1\u606F\u3002'));
    var field = document.createElement('input');
    field.placeholder = 'plaitcode://join?u=https://\u2026&s=\u2026';
    field.autocomplete = 'off';
    form.appendChild(field);
    var submitBtn = el('button', 'primary', '\u8FDB\u5165');
    submitBtn.type = 'submit';
    form.appendChild(submitBtn);
    var err = el('div', 'err', errorText || '');
    form.appendChild(err);
    main.appendChild(form);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var value = field.value.trim();
      var match = /[?&]s=([^&\\s]+)/.exec(value);
      var key = match ? decodeURIComponent(match[1]) : value;
      if (key.length < 16) { err.textContent = '\u8FD9\u6761\u914D\u5BF9\u4FE1\u606F\u770B\u4E0D\u61C2\uFF0C\u91CD\u65B0\u626B\u4E00\u6B21\u4E8C\u7EF4\u7801\u3002'; return; }
      localStorage.setItem(KEY_STORE, key);
      boot(key);
    });
  }

  function boot(candidate) {
    secret = candidate;
    history.replaceState(null, '', location.pathname);
    say('\u6B63\u5728\u8FDE\u63A5\u2026');
    deriveKeys().then(function (ready) {
      keys = ready;
      deviceId = localStorage.getItem('plaitcode.relay.device');
      if (!deviceId) {
        deviceId = 'web' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('plaitcode.relay.device', deviceId);
      }
      footer.style.display = 'flex';
      presence();
      setInterval(presence, 30000);
      poll();
      setInterval(poll, 1500);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
    }).catch(function () { say('\u6D4F\u89C8\u5668\u4E0D\u652F\u6301 WebCrypto\uFF0C\u65E0\u6CD5\u52A0\u5BC6'); });
  }

  var fromHash = null;
  var hash = location.hash || '';
  var hashMatch = /[#&]k=([^&]+)/.exec(hash);
  if (hashMatch) fromHash = decodeURIComponent(hashMatch[1]);
  var stored = localStorage.getItem(KEY_STORE);
  if (fromHash && fromHash.length >= 16) {
    localStorage.setItem(KEY_STORE, fromHash);
    boot(fromHash);
  } else if (stored && stored.length >= 16) {
    boot(stored);
  } else {
    joinForm('');
  }
})();
</script>
</body>
</html>`}var et=10*6e4,tt=720*6e4;var nt=5*6e4;function V(t){let e={};for(let n of(t??"").split(";")){let r=n.indexOf("=");if(r<=0)continue;let a=n.slice(0,r).trim();a&&(e[a]=decodeURIComponent(n.slice(r+1).trim()))}return e}var $=require("node:crypto"),L=require("node:fs/promises"),se=require("node:path"),X=1,Ue=100;function de(){return{version:X,orgs:[],members:[],devices:[]}}function W(t){return`${t}_${(0,$.randomBytes)(9).toString("base64url")}`}function ze(){return`pct_${(0,$.randomBytes)(24).toString("base64url")}`}function ce(t){return(0,$.createHash)("sha256").update(t,"utf8").digest("hex")}function je(t,e){let n=Buffer.from(t,"utf8"),r=Buffer.from(e,"utf8");return n.length===r.length&&(0,$.timingSafeEqual)(n,r)}var Fe={viewer:["poll","presence"],member:["publish","poll","presence"],admin:["publish","poll","presence","manage"],owner:["publish","poll","presence","manage"]};function le(t,e){return(Fe[t]??[]).includes(e)}function ue(t){return t==="owner"||t==="admin"||t==="member"||t==="viewer"}function pe(t,e){let n={id:W("org"),name:e.trim().slice(0,80)||"org",createdAt:Date.now()};return t.orgs.push(n),n}function Q(t,e){if(!t.orgs.some(a=>a.id===e.orgId))return;let n=ue(e.role)?e.role:"member",r={id:W("mem"),orgId:e.orgId,name:e.name.trim().slice(0,80)||"member",role:n,createdAt:Date.now()};return e.email?.trim()&&(r.email=e.email.trim()),e.openId?.trim()&&(r.openId=e.openId.trim()),e.unionId?.trim()&&(r.unionId=e.unionId.trim()),t.members.push(r),r}function fe(t,e){let n=e.email?.trim().toLowerCase();if(n){let r=t.members.find(a=>a.id&&a.email?.trim().toLowerCase()===n);if(r)return r}if(e.openId){let r=t.members.find(a=>a.id&&a.openId===e.openId);if(r)return r}if(e.unionId)return t.members.find(r=>r.id&&r.unionId===e.unionId)}function me(t,e){let n=t.members.find(u=>u.id===e.memberId);if(!n)return;let r=ze(),a=e.channels.filter(u=>typeof u.channelId=="string"&&u.channelId.trim().length>0).slice(0,Ue).map(u=>({channelId:u.channelId.trim().slice(0,64),role:ue(u.role)?u.role:n.role})),s={id:W("dev"),memberId:n.id,name:e.name.trim().slice(0,80)||"device",platform:(e.platform??"unknown").slice(0,20),tokenHash:ce(r),grants:a,createdAt:Date.now()};return t.devices.push(s),{device:s,token:r}}function ge(t,e){let n=t.devices.find(r=>r.id===e);return!n||n.revokedAt?!1:(n.revokedAt=Date.now(),!0)}function Ke(t,e){if(!e.startsWith("pct_"))return;let n=ce(e);return t.devices.find(r=>je(r.tokenHash,n))}function he(t,e,n,r){let a=Ke(t,e);if(!a)return{ok:!1,reason:"\u8BBE\u5907\u4EE4\u724C\u65E0\u6548"};if(a.revokedAt)return{ok:!1,device:a,reason:"\u8BBE\u5907\u5DF2\u88AB\u540A\u9500"};let s=t.members.find(m=>m.id===a.memberId);if(!s)return{ok:!1,device:a,reason:"\u8BBE\u5907\u6240\u5C5E\u6210\u5458\u5DF2\u4E0D\u5B58\u5728"};let u=a.grants.find(m=>m.channelId===n);return u?le(u.role,r)?(a.lastSeenAt=Date.now(),{ok:!0,device:a,member:s}):{ok:!1,device:a,member:s,reason:`\u89D2\u8272 ${u.role} \u4E0D\u80FD\u6267\u884C ${r}`}:{ok:!1,device:a,member:s,reason:"\u8FD9\u53F0\u8BBE\u5907\u6CA1\u6709\u8BE5\u9891\u9053\u7684\u6388\u6743"}}function ve(t,e,n,r){let a=t.members.find(y=>y.id===e);if(!a)return{ok:!1,reason:"\u6210\u5458\u4E0D\u5B58\u5728"};let s=t.devices.filter(y=>!y.revokedAt),u=s.filter(y=>y.memberId===e).flatMap(y=>y.grants).find(y=>y.channelId===n),m=u?.role??a.role;return(u?!0:s.some(y=>y.grants.some(g=>g.channelId===n)&&t.members.find(g=>g.id===y.memberId)?.orgId===a.orgId))?le(m,r)?{ok:!0,member:a}:{ok:!1,member:a,reason:`\u89D2\u8272 ${m} \u4E0D\u80FD\u6267\u884C ${r}`}:{ok:!1,member:a,reason:"\u8FD9\u4E2A\u9891\u9053\u4E0D\u5C5E\u4E8E\u4F60\u6240\u5728\u7684\u7EC4\u7EC7"}}async function be(t,e){await(0,L.mkdir)((0,se.dirname)(t),{recursive:!0}).catch(()=>{});let n=`${t}.tmp`;await(0,L.writeFile)(n,`${JSON.stringify(e,null,2)}
`,"utf8"),await(0,L.rename)(n,t)}async function ye(t){try{let e=await(0,L.readFile)(t,"utf8"),n=JSON.parse(e);return n.version!==X||!Array.isArray(n.orgs)||!Array.isArray(n.members)||!Array.isArray(n.devices)?void 0:{version:X,orgs:n.orgs,members:n.members,devices:n.devices}}catch{return}}function xe(t){return{version:t.version,orgs:t.orgs,members:t.members,devices:t.devices.map(e=>({id:e.id,memberId:e.memberId,name:e.name,platform:e.platform,grants:e.grants,createdAt:e.createdAt,lastSeenAt:e.lastSeenAt,revokedAt:e.revokedAt}))}}var G=require("node:crypto"),ke={authorize:"https://accounts.feishu.cn/open-apis/authen/v1/authorize",token:"https://open.feishu.cn/open-apis/authen/v2/oauth/token",userinfo:"https://open.feishu.cn/open-apis/authen/v1/user_info"};function Z(t){return t.toString("base64url")}function J(t,e){return Z((0,G.createHmac)("sha256",t).update(e,"utf8").digest())}function we(t,e){let n=Buffer.from(t,"utf8"),r=Buffer.from(e,"utf8");return n.length===r.length&&(0,G.timingSafeEqual)(n,r)}function Ie(t,e){let n={...ke,...t.endpoints},r=new URL(n.authorize);return r.searchParams.set("client_id",t.appId),r.searchParams.set("app_id",t.appId),r.searchParams.set("redirect_uri",t.redirectUri),r.searchParams.set("response_type","code"),r.searchParams.set("state",e),r.toString()}function Se(t,e,n=10*6e4){let r=`${e}.${Date.now()+n}`;return`${Z(Buffer.from(r,"utf8"))}.${J(t,r)}`}function Ee(t,e){if(!e)return!1;let n=e.lastIndexOf(".");if(n<=0)return!1;let r=e.slice(0,n),a=e.slice(n+1),s;try{s=Buffer.from(r,"base64url").toString("utf8")}catch{return!1}if(!we(J(t,s),a))return!1;let u=Number(s.slice(s.lastIndexOf(".")+1));return Number.isFinite(u)&&u>Date.now()}function Ae(t,e){let n=Z(Buffer.from(JSON.stringify(e),"utf8"));return`${n}.${J(t,n)}`}function ee(t,e){if(!e)return;let n=e.lastIndexOf(".");if(n<=0)return;let r=e.slice(0,n),a=e.slice(n+1);if(we(J(t,r),a))try{let s=JSON.parse(Buffer.from(r,"base64url").toString("utf8"));return!s.memberId||typeof s.exp!="number"||s.exp<=Date.now()?void 0:s}catch{return}}function K(t){if(!t||typeof t!="object")return{};let e=t,n=e.data;return n&&typeof n=="object"?n:e}function A(t){return typeof t=="string"&&t.trim()?t.trim():void 0}async function Ce(t,e,n=fetch){let r={...ke,...t.endpoints},a=[{grant_type:"authorization_code",client_id:t.appId,client_secret:t.appSecret,code:e,redirect_uri:t.redirectUri},{grant_type:"authorization_code",app_id:t.appId,app_secret:t.appSecret,code:e}],s="\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE access_token";for(let u of a)try{let m=await n(r.token,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(u)}),S=await m.json().catch(()=>{}),y=A(K(S).access_token);if(!m.ok||!y){s=A(K(S).error_description)??A(K(S).msg)??`HTTP ${m.status}`;continue}let D=await(await n(r.userinfo,{headers:{authorization:`Bearer ${y}`}})).json().catch(()=>{}),E=K(D),O=A(E.name)??A(E.en_name);if(!O){s="\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE\u7528\u6237\u59D3\u540D";continue}return{ok:!0,identity:{name:O,...A(E.email)??A(E.enterprise_email)?{email:A(E.email)??A(E.enterprise_email)}:{},...A(E.open_id)?{openId:A(E.open_id)}:{},...A(E.union_id)?{unionId:A(E.union_id)}:{}}}}catch(m){s=m instanceof Error?m.message:String(m)}return{ok:!1,error:s}}function Te(t,e){if(!e.length)return!0;if(!t)return!1;let n=t.lastIndexOf("@");if(n<0)return!1;let r=t.slice(n+1).toLowerCase();return e.some(a=>a.trim().toLowerCase().replace(/^@/,"")===r)}var Ge="1",Je=96*1024,Ye=9e4;function _e(t){return(0,H.createHash)("sha256").update(t,"utf8").digest("hex")}function l(t,e,n,r={}){let a=JSON.stringify(n);t.writeHead(e,{"content-type":"application/json; charset=utf-8","content-length":Buffer.byteLength(a),"cache-control":"no-store","x-content-type-options":"nosniff",...r}),t.end(a)}function te(t){return new Promise(e=>{let n=[],r=0;t.on("data",a=>{if(r+=a.length,r>Je){e(void 0),t.destroy();return}n.push(a)}),t.on("end",()=>e(Buffer.concat(n).toString("utf8"))),t.on("error",()=>e(void 0))})}function Y(t){let e=t.headers.authorization??"";return/^Bearer\s+(.+)$/i.exec(e.trim())?.[1]?.trim()??""}function I(t){let e=t.headers["x-real-ip"];if(typeof e=="string"&&e.trim())return e.trim();let n=t.headers["x-forwarded-for"];return typeof n=="string"&&n.trim()?n.split(",")[0].trim():(t.socket.remoteAddress??"").replace(/^::ffff:/,"")}async function Pe(t={}){let e=Math.max(20,t.maxMessages??500),n=Math.max(1e3,Math.min(t.maxWaitMs??22e3,25e3)),r=Math.max(10,t.rateLimit??240),a=t.log??(()=>{}),s=new F(t.audit),u=new Map,m=new Map,S=(i,o)=>{let v=u.get(i);if(v)return v.keyHash===_e(o)?v:void 0;if(!/^[0-9a-f]{16,64}$/.test(i))return;let b={keyHash:_e(o),createdAt:Date.now(),seq:0,messages:[],waiters:[],seen:new Set,presence:new Map};return u.set(i,b),a(`[relay] \u65B0\u9891\u9053 ${i.slice(0,8)}\u2026`),b},y=i=>{let o=Date.now(),v=m.get(i);return!v||o>=v.resetAt?(m.set(i,{count:1,resetAt:o+6e4}),!0):(v.count+=1,v.count<=r)},g=t.identity,D=t.adminToken??"",E=i=>{if(!/^[0-9a-f]{16,64}$/.test(i))return;let o=u.get(i);if(o)return o;let v={keyHash:"",createdAt:Date.now(),seq:0,messages:[],waiters:[],seen:new Set,presence:new Map};return u.set(i,v),a(`[relay] \u65B0\u9891\u9053 ${i.slice(0,8)}\u2026\uFF08\u8EAB\u4EFD\u6A21\u5F0F\uFF09`),v},O=(i,o,v)=>{if(!g)return{ok:!0};let b=Y(i);if(b){let p=he(g.state,b,o,v);return p.ok?{ok:!0,deviceId:p.device?.id,member:p.member?.name}:{ok:!1,status:403,reason:p.reason??"\u672A\u6388\u6743"}}let P=t.auth;if(!P)return{ok:!1,status:403,reason:"\u8BBE\u5907\u4EE4\u724C\u65E0\u6548"};let N=ee(P.secret,V(i.headers.cookie).plaitcode_session);if(!N)return{ok:!1,status:401,reason:"\u672A\u767B\u5F55\uFF1A\u8BF7\u5148\u7528\u98DE\u4E66\u767B\u5F55"};let j=ve(g.state,N.memberId,o,v);return j.ok?{ok:!0,member:j.member?.name}:{ok:!1,status:403,reason:j.reason??"\u672A\u6388\u6743"}},T=async()=>{g?.path&&await be(g.path,g.state).catch(i=>{a(`[relay] \u8EAB\u4EFD\u5E93\u5199\u5165\u5931\u8D25\uFF1A${i instanceof Error?i.message:String(i)}`)})},z=i=>{if(!D||typeof i!="string")return!1;let o=(0,H.createHash)("sha256").update(i).digest(),v=(0,H.createHash)("sha256").update(D).digest();return o.length===v.length&&(0,H.timingSafeEqual)(o,v)},M=(0,Oe.createServer)((i,o)=>{(async()=>{let v=i.url??"/",b=v.split("?")[0]??"/",P=new URLSearchParams(v.slice(v.indexOf("?")+1)),N=b==="/health"||b==="/";if(!(N||b==="/m")){let p=I(i);if(!y(p)){s.record({event:"denied",ip:p,detail:"rate limited"}),l(o,429,{ok:!1,error:"too many requests"});return}}if(i.method==="GET"&&b==="/m"){let p=ae({relayHost:typeof i.headers.host=="string"?i.headers.host:"plaitcode.com",sessionAuth:!!g});o.writeHead(200,{"content-type":"text/html; charset=utf-8","content-length":Buffer.byteLength(p),"cache-control":"no-store","x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"no-referrer"}),o.end(p);return}if(b==="/v1/auth/feishu/start"&&i.method==="GET"){let p=t.auth;if(!p||!g){l(o,404,{ok:!1,error:"sso disabled"});return}let c=Se(p.secret,crypto.randomUUID());o.writeHead(302,{location:Ie(p.config,c),"cache-control":"no-store"}),o.end();return}if(b==="/v1/auth/feishu/callback"&&i.method==="GET"){let p=t.auth;if(!p||!g){l(o,404,{ok:!1,error:"sso disabled"});return}if(!Ee(p.secret,P.get("state")??void 0)){s.record({event:"denied",ip:I(i),detail:"sso state invalid"}),l(o,400,{ok:!1,error:"state \u65E0\u6548\u6216\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55"});return}let c=P.get("code")??"";if(!c){l(o,400,{ok:!1,error:"\u7F3A\u5C11 code"});return}let d=await Ce(p.config,c);if(!d.ok){s.record({event:"denied",ip:I(i),detail:`sso exchange failed: ${d.error}`}),l(o,502,{ok:!1,error:`\u98DE\u4E66\u767B\u5F55\u5931\u8D25\uFF1A${d.error}`});return}if(p.emailDomains?.length&&!d.identity.email){s.record({event:"denied",ip:I(i),detail:"sso email missing while domain allowlist configured"}),l(o,403,{ok:!1,error:"\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE\u90AE\u7BB1\uFF0C\u65E0\u6CD5\u6821\u9A8C\u57DF\u540D\u767D\u540D\u5355\u3002\u8BF7\u7ED9\u5E94\u7528\u5F00\u901A contact:user.email:readonly \u6743\u9650\u5E76\u53D1\u5E03\u7248\u672C\uFF0C\u6216\u628A PLAITCODE_AUTH_EMAIL_DOMAINS \u6E05\u7A7A\u3002"});return}if(!Te(d.identity.email,p.emailDomains??[])){s.record({event:"denied",ip:I(i),detail:`sso email not allowed: ${d.identity.email??"(none)"}`}),l(o,403,{ok:!1,error:"\u8FD9\u4E2A\u90AE\u7BB1\u4E0D\u5728\u5141\u8BB8\u7684\u57DF\u540D\u5185"});return}let f=d.identity,h=fe(g.state,f);if(!h&&(f.email||f.openId||f.unionId)){let x=g.state.orgs[0];if(!x){l(o,409,{ok:!1,error:"\u670D\u52A1\u7AEF\u8FD8\u6CA1\u6709\u7EC4\u7EC7\uFF0C\u8BF7\u7BA1\u7406\u5458\u5148\u5EFA\u7EC4\u7EC7"});return}h=Q(g.state,{orgId:x.id,name:f.name,role:"member",email:f.email,openId:f.openId,unionId:f.unionId}),h&&(await T(),s.record({event:"admin",ip:I(i),detail:`auto-provision ${f.email??f.openId??f.unionId}`}))}if(!h){s.record({event:"denied",ip:I(i),detail:"sso identity has no stable key"}),l(o,409,{ok:!1,error:"\u65E0\u6CD5\u5EFA\u7ACB\u6210\u5458\u8EAB\u4EFD\uFF1A\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE\u53EF\u7528\u4E8E\u8BC6\u522B\u8EAB\u4EFD\u7684\u6807\u8BC6\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458"});return}f.email&&!h.email&&(h.email=f.email,await T());let _=p.sessionTtlMs??720*6e4,k=Ae(p.secret,{memberId:h.id,name:h.name,...d.identity.email?{email:d.identity.email}:{},exp:Date.now()+_});s.record({event:"login",ip:I(i),detail:h.name}),o.writeHead(302,{location:"/m","set-cookie":`plaitcode_session=${k}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(_/1e3)}`,"cache-control":"no-store"}),o.end();return}if(b==="/v1/auth/me"&&i.method==="GET"){let p=t.auth;if(!p){l(o,404,{ok:!1,error:"sso disabled"});return}let c=ee(p.secret,V(i.headers.cookie).plaitcode_session);if(!c){l(o,401,{ok:!1,error:"\u672A\u767B\u5F55"});return}l(o,200,{ok:!0,member:{id:c.memberId,name:c.name,email:c.email??null}});return}if(b==="/v1/auth/logout"&&i.method==="POST"){o.writeHead(200,{"content-type":"application/json; charset=utf-8","set-cookie":"plaitcode_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"}),o.end(JSON.stringify({ok:!0}));return}if(b.startsWith("/v1/admin/")){if(!g||!D){l(o,404,{ok:!1,error:"admin api disabled"});return}if(!z(i.headers["x-plaitcode-admin"])){s.record({event:"denied",ip:I(i),detail:"admin auth failed"}),l(o,403,{ok:!1,error:"admin denied"});return}let p=i.method==="POST"?await te(i):"";if(p===void 0){l(o,413,{ok:!1,error:"body too large"});return}let c={};if(p)try{c=JSON.parse(p)}catch{l(o,400,{ok:!1,error:"invalid json"});return}if(b==="/v1/admin/state"&&i.method==="GET"){l(o,200,{ok:!0,identity:xe(g.state)});return}if(b==="/v1/admin/orgs"&&i.method==="POST"){let d=pe(g.state,String(c.name??""));await T(),s.record({event:"admin",ip:I(i),detail:`org ${d.name}`}),l(o,200,{ok:!0,org:d});return}if(b==="/v1/admin/members"&&i.method==="POST"){let d=Q(g.state,{orgId:String(c.orgId??""),name:String(c.name??""),role:c.role});if(!d){l(o,404,{ok:!1,error:"org not found"});return}await T(),s.record({event:"admin",ip:I(i),detail:`member ${d.name} (${d.role})`}),l(o,200,{ok:!0,member:d});return}if(b==="/v1/admin/devices"&&i.method==="POST"){let d=Array.isArray(c.channels)?c.channels:[],f=me(g.state,{memberId:String(c.memberId??""),name:String(c.name??""),platform:typeof c.platform=="string"?c.platform:void 0,channels:d.filter(h=>!!h&&typeof h=="object").map(h=>({channelId:String(h.channelId??""),role:h.role}))});if(!f){l(o,404,{ok:!1,error:"member not found"});return}await T(),s.record({event:"admin",ip:I(i),detail:`device ${f.device.name} for ${f.device.memberId}`}),l(o,200,{ok:!0,device:{id:f.device.id,memberId:f.device.memberId,name:f.device.name,grants:f.device.grants},token:f.token});return}if(b==="/v1/admin/devices/revoke"&&i.method==="POST"){let d=ge(g.state,String(c.deviceId??""));await T(),s.record({event:"admin",ip:I(i),detail:`revoke ${String(c.deviceId??"")} -> ${d}`}),l(o,d?200:404,{ok:d});return}l(o,404,{ok:!1,error:"not found"});return}if(i.method==="GET"&&N){l(o,200,{ok:!0,service:"plaitcode-relay",version:Ge,channels:u.size,uptime:Math.round(process.uptime())});return}if(!b.startsWith("/v1/")){l(o,404,{ok:!1,error:"not found"});return}if(i.method==="GET"&&b==="/v1/poll"){let p=P.get("channel")??"",c=O(i,p,"poll");if(!c.ok){s.record({event:"denied",channel:p.slice(0,32),ip:I(i),detail:c.reason}),l(o,c.status,{ok:!1,error:c.reason});return}let d=g?E(p):S(p,Y(i));if(!d){l(o,403,{ok:!1,error:"channel denied"});return}let f=Number(P.get("since")??0)||0,h=Math.min(Math.max(Number(P.get("wait")??20)*1e3||2e4,0),n),_=()=>d.messages.filter(B=>B.seq>f),k=_();if(k.length||h===0){l(o,200,{ok:!0,messages:k.slice(-200),seq:d.seq});return}let x=!1,w=()=>{if(x)return;x=!0;let B=d.waiters.indexOf(w);B>=0&&d.waiters.splice(B,1),clearTimeout(U),!o.writableEnded&&l(o,200,{ok:!0,messages:_().slice(-200),seq:d.seq})},U=setTimeout(w,h);U.unref?.(),d.waiters.push(w),i.on("close",()=>{if(x)return;x=!0;let B=d.waiters.indexOf(w);B>=0&&d.waiters.splice(B,1),clearTimeout(U)});return}if(i.method==="POST"&&b==="/v1/publish"){let p=await te(i);if(!p){l(o,413,{ok:!1,error:"body too large"});return}let c;try{c=JSON.parse(p)}catch{l(o,400,{ok:!1,error:"invalid json"});return}let d=typeof c.channel=="string"?c.channel:"",f=typeof c.id=="string"?c.id.slice(0,80):"",h=typeof c.from=="string"?c.from.slice(0,80):"",_=typeof c.envelope?.iv=="string"?c.envelope.iv:"",k=typeof c.envelope?.ct=="string"?c.envelope.ct:"";if(!f||!h||!_||!k||k.length>64*1024){l(o,400,{ok:!1,error:"invalid message"});return}let x=O(i,d,"publish");if(!x.ok){s.record({event:"denied",channel:d.slice(0,32),ip:I(i),detail:x.reason}),l(o,x.status,{ok:!1,error:x.reason});return}let w=g?E(d):S(d,Y(i));if(!w){s.record({event:"denied",channel:d.slice(0,32),ip:I(i),detail:"channel denied"}),l(o,403,{ok:!1,error:"channel denied"});return}if(w.seen.has(f)){s.record({event:"publish",channel:d,device:h,message:f,ip:I(i),detail:"duplicate"}),l(o,200,{ok:!0,duplicate:!0,seq:w.seq});return}w.seq+=1,w.seen.add(f),s.record({event:"publish",channel:d,device:h,message:f,ip:I(i),bytes:k.length}),w.seen.size>e*4&&(w.seen=new Set([...w.seen].slice(-e*2))),w.messages.push({seq:w.seq,id:f,from:h,envelope:{iv:_,ct:k},at:Date.now()}),w.messages.length>e&&(w.messages=w.messages.slice(-e));for(let U of[...w.waiters])U();l(o,200,{ok:!0,seq:w.seq});return}if(b==="/v1/presence"){let p=Y(i),c=P.get("channel")??"",d;if(i.method==="POST"){let k=await te(i);if(!k){l(o,413,{ok:!1,error:"body too large"});return}let x;try{x=JSON.parse(k)}catch{l(o,400,{ok:!1,error:"invalid json"});return}c=typeof x.channel=="string"?x.channel:"",d=x.device}let f=O(i,c,"presence");if(!f.ok){s.record({event:"denied",channel:c.slice(0,32),ip:I(i),detail:f.reason}),l(o,f.status,{ok:!1,error:f.reason});return}let h=g?E(c):S(c,p);if(!h){l(o,403,{ok:!1,error:"channel denied"});return}if(d){let k=f.deviceId??(typeof d.id=="string"?d.id.slice(0,80):"");if(!k){l(o,400,{ok:!1,error:"invalid device"});return}h.presence.set(k,{name:f.member?`${f.member} \xB7 ${typeof d.name=="string"?d.name.slice(0,60):"\u8BBE\u5907"}`:typeof d.name=="string"?d.name.slice(0,120):k,platform:typeof d.platform=="string"?d.platform:"unknown",project:typeof d.project=="string"?d.project.slice(0,120):"",at:Date.now()})}let _=Date.now();for(let[k,x]of h.presence)_-x.at>Ye&&h.presence.delete(k);l(o,200,{ok:!0,devices:[...h.presence.entries()].map(([k,x])=>({id:k,...x}))});return}l(o,404,{ok:!1,error:"not found"})})().catch(v=>{a(`[relay] \u8BF7\u6C42\u5904\u7406\u5931\u8D25\uFF1A${v instanceof Error?v.message:String(v)}`),o.writableEnded||l(o,500,{ok:!1,error:"internal error"})})});await new Promise((i,o)=>{M.once("error",o),M.listen(t.port??8787,t.host??"0.0.0.0",()=>{M.off("error",o),i()})});let C=M.address(),q=C&&typeof C=="object"?C.port:t.port??8787;return a(`[relay] \u76D1\u542C ${t.host??"0.0.0.0"}:${q}`),s.record({event:"startup",detail:`listen ${t.host??"0.0.0.0"}:${q}`}),{port:q,close:()=>new Promise(i=>{s.record({event:"shutdown"});for(let o of u.values())for(let v of[...o.waiters])v();M.close(()=>{s.flush().then(()=>i())}),setTimeout(()=>i(),1500).unref?.()})}}var Me=require("node:dgram"),Re=require("node:http"),Le=require("node:https"),Be=require("node:net");function $e(t){let e=(t??"").trim();if(e)try{if(/^otlp\+https?:\/\//i.test(e))return{kind:"otlp",url:new URL(e.replace(/^otlp\+/i,""))};if(/^syslog\+tcp:\/\//i.test(e))return{kind:"syslog-tcp",url:new URL(e.replace(/^syslog\+tcp:/i,"http:"))};if(/^syslog:\/\//i.test(e))return{kind:"syslog",url:new URL(e.replace(/^syslog:/i,"http:"))};if(/^https?:\/\//i.test(e))return{kind:"webhook",url:new URL(e)}}catch{return}}function De(t,e,n){let r;try{r=t}catch{return}let a=Buffer.from(e,"utf8"),u=(r.protocol==="https:"?Le.request:Re.request)(r,{method:"POST",headers:{"content-type":"application/json","content-length":String(a.length)},timeout:n},m=>{m.resume()});u.on("timeout",()=>u.destroy()),u.on("error",()=>{}),u.end(a)}function qe(t,e){let n=`${Date.now()}000000`;try{let r=JSON.parse(t);if(typeof r.ts=="string"){let a=Date.parse(r.ts);Number.isFinite(a)&&(n=`${a}000000`)}}catch{}return JSON.stringify({resourceLogs:[{resource:{attributes:[{key:"service.name",value:{stringValue:"plaitcode-relay"}},{key:"host.name",value:{stringValue:e}}]},scopeLogs:[{scope:{name:"plaitcode.audit"},logRecords:[{timeUnixNano:n,severityText:"INFO",body:{stringValue:t}}]}]}]})}function He(t,e={}){let n=e.hostname??"plaitcode-relay";if(t.kind==="webhook")return{send:m=>De(t.url,m,5e3),close:()=>{}};if(t.kind==="otlp")return{send:m=>De(t.url,qe(m,n),5e3),close:()=>{}};let r=t.url.hostname,a=Number(t.url.port||514);if(t.kind==="syslog"){let m=(0,Me.createSocket)("udp4");return m.on("error",()=>{}),m.unref?.(),{send:S=>{let y=`<14>1 - ${n} plaitcode-relay - AUDIT - ${S}`;try{m.send(Buffer.from(y,"utf8"),a,r,()=>{})}catch{}},close:()=>{try{m.close()}catch{}}}}let s,u=()=>(s&&!s.destroyed||(s=(0,Be.connect)(a,r,()=>{}),s.on("error",()=>{s=void 0}),s.on("close",()=>{s=void 0}),s.unref?.()),s);return{send:m=>{let S=u();if(S)try{S.write(`<14>1 - ${n} plaitcode-relay - AUDIT - ${m}
`)}catch{s=void 0}},close:()=>{try{s?.destroy()}catch{}}}}var Ne=require("node:os");async function Ve(){let t=Number(process.env.PLAITCODE_PORT??8787),e=process.env.PLAITCODE_HOST??"127.0.0.1",n=process.env.PLAITCODE_AUDIT??"/var/lib/plaitcode-relay/audit.jsonl",r=process.env.PLAITCODE_AUDIT_STDOUT!=="0",a=process.env.PLAITCODE_IDENTITY?.trim(),s=process.env.PLAITCODE_ADMIN_TOKEN?.trim()??"",u=a?{state:await ye(a)??de(),path:a}:void 0;u&&(console.log(`[relay] \u8EAB\u4EFD\u6A21\u5F0F\uFF1A${u.state.orgs.length} \u7EC4\u7EC7 / ${u.state.members.length} \u6210\u5458 / ${u.state.devices.length} \u8BBE\u5907`),s||console.log("[relay] \u8B66\u544A\uFF1A\u6CA1\u8BBE PLAITCODE_ADMIN_TOKEN\uFF0C\u7BA1\u7406\u63A5\u53E3\u4E0D\u53EF\u7528"));let m=$e(process.env.PLAITCODE_AUDIT_SINK),S=m?He(m,{hostname:(0,Ne.hostname)()}):void 0;m&&console.log(`[relay] \u5BA1\u8BA1\u5916\u9001\uFF1A${m.kind} \u2192 ${m.url.host}`);let y=process.env.PLAITCODE_FEISHU_APP_ID?.trim()??"",g=process.env.PLAITCODE_FEISHU_APP_SECRET?.trim()??"",D=process.env.PLAITCODE_AUTH_SECRET?.trim()??"",E=(process.env.PLAITCODE_PUBLIC_URL?.trim()||"https://plaitcode.com").replace(/\/+$/,""),O=y&&g?{appId:y,appSecret:g,redirectUri:`${E}/v1/auth/feishu/callback`,...process.env.PLAITCODE_FEISHU_AUTHORIZE?{endpoints:{authorize:process.env.PLAITCODE_FEISHU_AUTHORIZE}}:{},...process.env.PLAITCODE_FEISHU_TOKEN?{endpoints:{token:process.env.PLAITCODE_FEISHU_TOKEN}}:{},...process.env.PLAITCODE_FEISHU_USERINFO?{endpoints:{userinfo:process.env.PLAITCODE_FEISHU_USERINFO}}:{}}:void 0,T=O&&D&&u?{config:O,secret:D,emailDomains:(process.env.PLAITCODE_AUTH_EMAIL_DOMAINS??"").split(",").map(C=>C.trim()).filter(Boolean)}:void 0;T?console.log("[relay] \u98DE\u4E66\u767B\u5F55\u5DF2\u542F\u7528"):y&&console.log("[relay] \u8B66\u544A\uFF1A\u98DE\u4E66\u767B\u5F55\u9700\u8981 PLAITCODE_AUTH_SECRET \u4E0E\u8EAB\u4EFD\u5E93\uFF08PLAITCODE_IDENTITY\uFF09");let z=await Pe({port:Number.isFinite(t)&&t>0?t:8787,host:e,log:C=>console.log(C),...u?{identity:u}:{},...s?{adminToken:s}:{},...T?{auth:T}:{},audit:{...n&&n!=="-"?{path:n}:{},sink:(C=>{r&&console.log(`[audit] ${C}`),S?.send(C)}),includeIp:process.env.PLAITCODE_AUDIT_IP!=="0",maxBytes:Number(process.env.PLAITCODE_AUDIT_MAX_BYTES??20*1024*1024),keep:Number(process.env.PLAITCODE_AUDIT_KEEP??5)}});console.log(`[relay] ready on http://${e}:${z.port}`);let M=C=>{console.log(`[relay] ${C}\uFF0C\u6B63\u5728\u5173\u95ED`),S?.close(),z.close().then(()=>process.exit(0))};process.on("SIGTERM",()=>M("SIGTERM")),process.on("SIGINT",()=>M("SIGINT"))}Ve().catch(t=>{console.error(`[relay] \u542F\u52A8\u5931\u8D25\uFF1A${t instanceof Error?t.message:String(t)}`),process.exit(1)});
