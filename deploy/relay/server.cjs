"use strict";var z=require("node:crypto"),Be=require("node:http");var $=require("node:fs/promises"),de=require("node:path"),G=class{constructor(e={}){this.options=e;this.maxBytes=Math.max(4*1024,e.maxBytes??20*1024*1024),this.keep=Math.max(1,Math.min(e.keep??3,20)),this.includeIp=e.includeIp??!0}options;maxBytes;keep;includeIp;queue=Promise.resolve();written=0;record(e){let n={ts:(this.options.now?.()??new Date).toISOString(),event:e.event,...e.channel?{channel:e.channel}:{},...e.device?{device:e.device}:{},...e.message?{message:e.message}:{},...e.ip&&this.includeIp?{ip:e.ip}:{},...typeof e.bytes=="number"?{bytes:e.bytes}:{},...e.detail?{detail:e.detail}:{}},o=`${JSON.stringify(n)}
`;try{this.options.sink?.(o.trimEnd())}catch{}let s=this.options.path;s&&(this.queue=this.queue.then(()=>this.append(s,o)).catch(()=>{}))}async flush(){await this.queue.catch(()=>{})}async append(e,n){let o=Buffer.byteLength(n);this.written===0&&(this.written=await(0,$.stat)(e).then(s=>s.size).catch(()=>0)),this.written+o>this.maxBytes&&(await this.rotate(e),this.written=0),await(0,$.mkdir)((0,de.dirname)(e),{recursive:!0}).catch(()=>{}),await(0,$.appendFile)(e,n,"utf8"),this.written+=o}async rotate(e){for(let n=this.keep;n>=1;n-=1){let o=n===1?e:`${e}.${n-1}`,s=`${e}.${n}`;await(0,$.rename)(o,s).catch(()=>{})}}};var D=require("node:fs/promises"),ce=require("node:path"),Ve=/^[0-9a-f]{16,64}$/;function le(t,e=500){if(!t)return{load:async()=>[],append:()=>{},flush:async()=>{}};let n=new Map,o=i=>Ve.test(i)?(0,ce.join)(t,`${i}.jsonl`):void 0,s=i=>{let m=[];for(let c of i.split(`
`))if(c.trim())try{let p=JSON.parse(c);if(typeof p.seq!="number"||!Number.isFinite(p.seq)||typeof p.id!="string"||!p.id||typeof p.iv!="string"||typeof p.ct!="string")continue;m.push({seq:p.seq,id:p.id,from:typeof p.from=="string"?p.from:"",iv:p.iv,ct:p.ct,at:typeof p.at=="number"&&Number.isFinite(p.at)?p.at:0})}catch{}return m.sort((c,p)=>c.seq-p.seq)};return{async load(i){let m=o(i);if(!m)return[];let c;try{c=await(0,D.readFile)(m,"utf8")}catch{return[]}let p=s(c),b=e>0?p.slice(-e):p;if(p.length>b.length*2&&b.length>0){let T=b.map(h=>JSON.stringify(h)).join(`
`),P=`${m}.tmp`;await(0,D.writeFile)(P,`${T}
`,"utf8").catch(()=>{}),await(0,D.rename)(P,m).catch(()=>{})}return b},append(i,m){let c=o(i);if(!c)return;let p=`${JSON.stringify(m)}
`,T=(n.get(i)??Promise.resolve()).then(async()=>{await(0,D.mkdir)(t,{recursive:!0}).catch(()=>{}),await(0,D.appendFile)(c,p,"utf8")}).catch(()=>{});n.set(i,T),T.then(()=>{n.get(i)===T&&n.delete(i)})},async flush(){await Promise.all([...n.values()])}}}var ue="plaitcode/channel/1:",pe="plaitcode/relay/1:",fe="plaitcode/enc/1:";function me(t){let e=t.relayHost.replace(/[<>&"]/g,""),n=t.sessionAuth===!0;return`<!doctype html>
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
  var PHASES = { requirement:'\u9700\u6C42', analysis:'\u89E3\u6790', question:'\u8FFD\u95EE', answer:'\u56DE\u590D', confirm:'\u786E\u8BA4', progress:'\u8FDB\u5EA6', result:'\u7ED3\u679C', blocked:'\u672A\u6267\u884C' };
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
    return Promise.all([digest('${ue}'), digest('${pe}'), digest('${fe}')])
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
        // \u624B\u673A\u53EA\u662F"\u7532\u65B9"\uFF0C\u771F\u6B63\u7684\u6267\u884C\u8005\u662F\u90A3\u4E9B\u7535\u8111\uFF1A\u5217\u51FA\u9664\u81EA\u5DF1\u4EE5\u5916\u7684\u8BBE\u5907\u4F9B\u6307\u6D3E
        devices = result.devices.filter(function (item) {
          return item && item.id && item.id !== deviceId;
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

  var STATUS_LABEL = { question:'\u7B49\u4F60\u56DE\u590D', blocked:'\u672A\u6267\u884C', running:'\u8FDB\u884C\u4E2D', open:'\u5F85\u63A5', done:'\u5DF2\u5B8C\u6210' };
  var STATUS_ORDER = ['question', 'blocked', 'running', 'open', 'done'];
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
      else if (m.phase === 'blocked') { if (task.status !== 'done') { task.status = 'blocked'; task.line = m.body; } }
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
    if (!main.childNodes.length) main.appendChild(el('div', 'empty', '\u8FD8\u6CA1\u6709\u53D1\u8A00\u3002\u8BF4\u4E00\u53E5\u9700\u6C42\uFF0C\u9891\u9053\u91CC\u7684\u4E59\u65B9\u90FD\u4F1A\u6536\u5230\u3002'));
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
    // \u6307\u6D3E\uFF1A\u8BF4\u6E05\u8BA9\u54EA\u53F0\u7535\u8111\u505A\uFF0C\u907F\u514D\u6BCF\u53F0\u90FD\u8DD1\u4E00\u904D\u3001\u6539\u52A8\u4E92\u76F8\u8986\u76D6
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
</html>`}var ct=10*6e4,lt=720*6e4;var ut=5*6e4;function ee(t){let e={};for(let n of(t??"").split(";")){let o=n.indexOf("=");if(o<=0)continue;let s=n.slice(0,o).trim();s&&(e[s]=decodeURIComponent(n.slice(o+1).trim()))}return e}var U=require("node:crypto"),B=require("node:fs/promises"),he=require("node:path"),te=1,Ye=100,We=0,ft=1440*6e4;function ve(){return{version:te,orgs:[],members:[],devices:[]}}function ne(t){return`${t}_${(0,U.randomBytes)(9).toString("base64url")}`}function Xe(){return`pct_${(0,U.randomBytes)(24).toString("base64url")}`}function be(t){return(0,U.createHash)("sha256").update(t,"utf8").digest("hex")}function ge(t,e){let n=Buffer.from(t,"utf8"),o=Buffer.from(e,"utf8");return n.length===o.length&&(0,U.timingSafeEqual)(n,o)}var Qe={viewer:["poll","presence"],member:["publish","poll","presence"],admin:["publish","poll","presence","manage"],owner:["publish","poll","presence","manage"]};function ye(t,e){return(Qe[t]??[]).includes(e)}function xe(t){return t==="owner"||t==="admin"||t==="member"||t==="viewer"}function ke(t,e){let n={id:ne("org"),name:e.trim().slice(0,80)||"org",createdAt:Date.now()};return t.orgs.push(n),n}function re(t,e){if(!t.orgs.some(s=>s.id===e.orgId))return;let n=xe(e.role)?e.role:"member",o={id:ne("mem"),orgId:e.orgId,name:e.name.trim().slice(0,80)||"member",role:n,createdAt:Date.now()};return e.email?.trim()&&(o.email=e.email.trim()),e.openId?.trim()&&(o.openId=e.openId.trim()),e.unionId?.trim()&&(o.unionId=e.unionId.trim()),t.members.push(o),o}function we(t,e){let n=e.email?.trim().toLowerCase();if(n){let o=t.members.find(s=>s.id&&s.email?.trim().toLowerCase()===n);if(o)return o}if(e.openId){let o=t.members.find(s=>s.id&&s.openId===e.openId);if(o)return o}if(e.unionId)return t.members.find(o=>o.id&&o.unionId===e.unionId)}function ie(t,e){let n=t.members.find(c=>c.id===e.memberId);if(!n)return;let o=Xe(),s=e.channels.filter(c=>typeof c.channelId=="string"&&c.channelId.trim().length>0).slice(0,Ye).map(c=>({channelId:c.channelId.trim().slice(0,64),role:xe(c.role)?c.role:n.role})),i=e.ttlMs===void 0?We:e.ttlMs,m={id:ne("dev"),memberId:n.id,name:e.name.trim().slice(0,80)||"device",platform:(e.platform??"unknown").slice(0,20),tokenHash:be(o),grants:s,createdAt:Date.now(),...i>0?{expiresAt:Date.now()+i}:{}};return t.devices.push(m),{device:m,token:o}}function Ie(t,e){let n=t.devices.find(o=>o.id===e);return!n||n.revokedAt?!1:(n.revokedAt=Date.now(),!0)}function oe(t,e,n=Date.now()){if(!e.startsWith("pct_"))return;let o=be(e),s=t.devices.find(i=>ge(i.tokenHash,o));return s||t.devices.find(i=>i.previousTokenHash&&i.previousValidUntil!==void 0&&n<i.previousValidUntil&&ge(i.previousTokenHash,o))}function Se(t,e,n,o,s=Date.now()){let i=oe(t,e,s);if(!i)return{ok:!1,reason:"\u8BBE\u5907\u4EE4\u724C\u65E0\u6548"};if(i.revokedAt)return{ok:!1,device:i,reason:"\u8BBE\u5907\u5DF2\u88AB\u540A\u9500"};if(i.expiresAt!==void 0&&s>i.expiresAt)return{ok:!1,device:i,reason:"\u8BBE\u5907\u4EE4\u724C\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u8BB0\u8BBE\u5907"};let m=t.members.find(p=>p.id===i.memberId);if(!m)return{ok:!1,device:i,reason:"\u8BBE\u5907\u6240\u5C5E\u6210\u5458\u5DF2\u4E0D\u5B58\u5728"};let c=i.grants.find(p=>p.channelId===n);return c?ye(c.role,o)?(i.lastSeenAt=Date.now(),{ok:!0,device:i,member:m}):{ok:!1,device:i,member:m,reason:`\u89D2\u8272 ${c.role} \u4E0D\u80FD\u6267\u884C ${o}`}:{ok:!1,device:i,member:m,reason:"\u8FD9\u53F0\u8BBE\u5907\u6CA1\u6709\u8BE5\u9891\u9053\u7684\u6388\u6743"}}function Ee(t,e,n,o){let s=t.members.find(b=>b.id===e);if(!s)return{ok:!1,reason:"\u6210\u5458\u4E0D\u5B58\u5728"};let i=t.devices.filter(b=>!b.revokedAt),m=i.filter(b=>b.memberId===e).flatMap(b=>b.grants).find(b=>b.channelId===n),c=m?.role??s.role;return(m?!0:i.some(b=>b.grants.some(T=>T.channelId===n)&&t.members.find(T=>T.id===b.memberId)?.orgId===s.orgId))?ye(c,o)?{ok:!0,member:s}:{ok:!1,member:s,reason:`\u89D2\u8272 ${c} \u4E0D\u80FD\u6267\u884C ${o}`}:{ok:!1,member:s,reason:"\u8FD9\u4E2A\u9891\u9053\u4E0D\u5C5E\u4E8E\u4F60\u6240\u5728\u7684\u7EC4\u7EC7"}}async function Ae(t,e){await(0,B.mkdir)((0,he.dirname)(t),{recursive:!0}).catch(()=>{});let n=`${t}.tmp`;await(0,B.writeFile)(n,`${JSON.stringify(e,null,2)}
`,"utf8"),await(0,B.rename)(n,t)}async function Te(t){try{let e=await(0,B.readFile)(t,"utf8"),n=JSON.parse(e);return n.version!==te||!Array.isArray(n.orgs)||!Array.isArray(n.members)||!Array.isArray(n.devices)?void 0:{version:te,orgs:n.orgs,members:n.members,devices:n.devices}}catch{return}}function Ce(t){return{version:t.version,orgs:t.orgs,members:t.members,devices:t.devices.map(e=>({id:e.id,memberId:e.memberId,name:e.name,platform:e.platform,grants:e.grants,createdAt:e.createdAt,lastSeenAt:e.lastSeenAt,revokedAt:e.revokedAt}))}}var Y=require("node:crypto"),_e={authorize:"https://accounts.feishu.cn/open-apis/authen/v1/authorize",token:"https://open.feishu.cn/open-apis/authen/v2/oauth/token",userinfo:"https://open.feishu.cn/open-apis/authen/v1/user_info"};function ae(t){return t.toString("base64url")}function W(t,e){return ae((0,Y.createHmac)("sha256",t).update(e,"utf8").digest())}function Oe(t,e){let n=Buffer.from(t,"utf8"),o=Buffer.from(e,"utf8");return n.length===o.length&&(0,Y.timingSafeEqual)(n,o)}function Pe(t,e){let n={..._e,...t.endpoints},o=new URL(n.authorize);return o.searchParams.set("client_id",t.appId),o.searchParams.set("app_id",t.appId),o.searchParams.set("redirect_uri",t.redirectUri),o.searchParams.set("response_type","code"),o.searchParams.set("state",e),o.toString()}function De(t,e,n=10*6e4){let o=`${e}.${Date.now()+n}`;return`${ae(Buffer.from(o,"utf8"))}.${W(t,o)}`}function Me(t,e){if(!e)return!1;let n=e.lastIndexOf(".");if(n<=0)return!1;let o=e.slice(0,n),s=e.slice(n+1),i;try{i=Buffer.from(o,"base64url").toString("utf8")}catch{return!1}if(!Oe(W(t,i),s))return!1;let m=Number(i.slice(i.lastIndexOf(".")+1));return Number.isFinite(m)&&m>Date.now()}function Le(t,e){let n=ae(Buffer.from(JSON.stringify(e),"utf8"));return`${n}.${W(t,n)}`}function se(t,e){if(!e)return;let n=e.lastIndexOf(".");if(n<=0)return;let o=e.slice(0,n),s=e.slice(n+1);if(Oe(W(t,o),s))try{let i=JSON.parse(Buffer.from(o,"base64url").toString("utf8"));return!i.memberId||typeof i.exp!="number"||i.exp<=Date.now()?void 0:i}catch{return}}function V(t){if(!t||typeof t!="object")return{};let e=t,n=e.data;return n&&typeof n=="object"?n:e}function C(t){return typeof t=="string"&&t.trim()?t.trim():void 0}async function He(t,e,n=fetch){let o={..._e,...t.endpoints},s=[{grant_type:"authorization_code",client_id:t.appId,client_secret:t.appSecret,code:e,redirect_uri:t.redirectUri},{grant_type:"authorization_code",app_id:t.appId,app_secret:t.appSecret,code:e}],i="\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE access_token";for(let m of s)try{let c=await n(o.token,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(m)}),p=await c.json().catch(()=>{}),b=C(V(p).access_token);if(!c.ok||!b){i=C(V(p).error_description)??C(V(p).msg)??`HTTP ${c.status}`;continue}let P=await(await n(o.userinfo,{headers:{authorization:`Bearer ${b}`}})).json().catch(()=>{}),h=V(P),M=C(h.name)??C(h.en_name);if(!M){i="\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE\u7528\u6237\u59D3\u540D";continue}return{ok:!0,identity:{name:M,...C(h.email)??C(h.enterprise_email)?{email:C(h.email)??C(h.enterprise_email)}:{},...C(h.open_id)?{openId:C(h.open_id)}:{},...C(h.union_id)?{unionId:C(h.union_id)}:{}}}}catch(c){i=c instanceof Error?c.message:String(c)}return{ok:!1,error:i}}function Re(t,e){if(!e.length)return!0;if(!t)return!1;let n=t.lastIndexOf("@");if(n<0)return!1;let o=t.slice(n+1).toLowerCase();return e.some(s=>s.trim().toLowerCase().replace(/^@/,"")===o)}var Ze="1",et=96*1024,tt=9e4;function $e(t){return(0,z.createHash)("sha256").update(t,"utf8").digest("hex")}function l(t,e,n,o={}){let s=JSON.stringify(n);t.writeHead(e,{"content-type":"application/json; charset=utf-8","content-length":Buffer.byteLength(s),"cache-control":"no-store","x-content-type-options":"nosniff",...o}),t.end(s)}function X(t){return new Promise(e=>{let n=[],o=0;t.on("data",s=>{if(o+=s.length,o>et){e(void 0),t.destroy();return}n.push(s)}),t.on("end",()=>e(Buffer.concat(n).toString("utf8"))),t.on("error",()=>e(void 0))})}function q(t){let e=t.headers.authorization??"";return/^Bearer\s+(.+)$/i.exec(e.trim())?.[1]?.trim()??""}function E(t){let e=t.headers["x-real-ip"];if(typeof e=="string"&&e.trim())return e.trim();let n=t.headers["x-forwarded-for"];return typeof n=="string"&&n.trim()?n.split(",")[0].trim():(t.socket.remoteAddress??"").replace(/^::ffff:/,"")}async function Ne(t={}){let e=Math.max(20,t.maxMessages??500),n=Math.max(1e3,Math.min(t.maxWaitMs??22e3,25e3)),o=Math.max(10,t.rateLimit??240),s=t.log??(()=>{}),i=new G(t.audit),m=new Map,c=new Map,p=le(t.historyDir,e),b=(r,a)=>(r.ready||(r.ready=p.load(a).then(y=>{if(!y.length)return;let x=new Set(r.messages.map(k=>k.id));for(let k of y)x.has(k.id)||(r.messages.push({seq:k.seq,id:k.id,from:k.from,envelope:{iv:k.iv,ct:k.ct},at:k.at}),r.seen.add(k.id),k.seq>r.seq&&(r.seq=k.seq));r.messages.sort((k,N)=>k.seq-N.seq),r.messages.length>e&&(r.messages=r.messages.slice(-e)),s(`[relay] \u9891\u9053 ${a.slice(0,8)}\u2026 \u4ECE\u78C1\u76D8\u6062\u590D ${y.length} \u6761\uFF0Cseq=${r.seq}`)}).catch(()=>{})),r.ready),T=(r,a)=>{let y=m.get(r);if(y)return y.keyHash===$e(a)?y:void 0;if(!/^[0-9a-f]{16,64}$/.test(r))return;let x={keyHash:$e(a),createdAt:Date.now(),seq:0,messages:[],waiters:[],seen:new Set,presence:new Map};return m.set(r,x),b(x,r),s(`[relay] \u65B0\u9891\u9053 ${r.slice(0,8)}\u2026`),x},P=r=>{let a=Date.now(),y=c.get(r);return!y||a>=y.resetAt?(c.set(r,{count:1,resetAt:a+6e4}),!0):(y.count+=1,y.count<=o)},h=t.identity,M=t.adminToken??"",F=r=>{if(!/^[0-9a-f]{16,64}$/.test(r))return;let a=m.get(r);if(a)return a;let y={keyHash:"",createdAt:Date.now(),seq:0,messages:[],waiters:[],seen:new Set,presence:new Map};return m.set(r,y),b(y,r),s(`[relay] \u65B0\u9891\u9053 ${r.slice(0,8)}\u2026\uFF08\u8EAB\u4EFD\u6A21\u5F0F\uFF09`),y},j=(r,a,y)=>{if(!h)return{ok:!0};let x=q(r);if(x){let g=Se(h.state,x,a,y);return g.ok?{ok:!0,deviceId:g.device?.id,member:g.member?.name}:{ok:!1,status:403,reason:g.reason??"\u672A\u6388\u6743"}}let k=t.auth;if(!k)return{ok:!1,status:403,reason:"\u8BBE\u5907\u4EE4\u724C\u65E0\u6548"};let N=se(k.secret,ee(r.headers.cookie).plaitcode_session);if(!N)return{ok:!1,status:401,reason:"\u672A\u767B\u5F55\uFF1A\u8BF7\u5148\u7528\u98DE\u4E66\u767B\u5F55"};let J=Ee(h.state,N.memberId,a,y);return J.ok?{ok:!0,member:J.member?.name}:{ok:!1,status:403,reason:J.reason??"\u672A\u6388\u6743"}},O=async()=>{h?.path&&await Ae(h.path,h.state).catch(r=>{s(`[relay] \u8EAB\u4EFD\u5E93\u5199\u5165\u5931\u8D25\uFF1A${r instanceof Error?r.message:String(r)}`)})},K=r=>{if(!M||typeof r!="string")return!1;let a=(0,z.createHash)("sha256").update(r).digest(),y=(0,z.createHash)("sha256").update(M).digest();return a.length===y.length&&(0,z.timingSafeEqual)(a,y)},R=(0,Be.createServer)((r,a)=>{(async()=>{let y=r.url??"/",x=y.split("?")[0]??"/",k=new URLSearchParams(y.slice(y.indexOf("?")+1)),N=x==="/health"||x==="/";if(!(N||x==="/m")){let g=E(r);if(!P(g)){i.record({event:"denied",ip:g,detail:"rate limited"}),l(a,429,{ok:!1,error:"too many requests"});return}}if(r.method==="GET"&&x==="/m"){let g=me({relayHost:typeof r.headers.host=="string"?r.headers.host:"plaitcode.com",sessionAuth:!!h});a.writeHead(200,{"content-type":"text/html; charset=utf-8","content-length":Buffer.byteLength(g),"cache-control":"no-store","x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"no-referrer"}),a.end(g);return}if(x==="/v1/auth/feishu/start"&&r.method==="GET"){let g=t.auth;if(!g||!h){l(a,404,{ok:!1,error:"sso disabled"});return}let u=De(g.secret,crypto.randomUUID());a.writeHead(302,{location:Pe(g.config,u),"cache-control":"no-store"}),a.end();return}if(x==="/v1/auth/feishu/callback"&&r.method==="GET"){let g=t.auth;if(!g||!h){l(a,404,{ok:!1,error:"sso disabled"});return}if(!Me(g.secret,k.get("state")??void 0)){i.record({event:"denied",ip:E(r),detail:"sso state invalid"}),l(a,400,{ok:!1,error:"state \u65E0\u6548\u6216\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55"});return}let u=k.get("code")??"";if(!u){l(a,400,{ok:!1,error:"\u7F3A\u5C11 code"});return}let d=await He(g.config,u);if(!d.ok){i.record({event:"denied",ip:E(r),detail:`sso exchange failed: ${d.error}`}),l(a,502,{ok:!1,error:`\u98DE\u4E66\u767B\u5F55\u5931\u8D25\uFF1A${d.error}`});return}if(g.emailDomains?.length&&!d.identity.email){i.record({event:"denied",ip:E(r),detail:"sso email missing while domain allowlist configured"}),l(a,403,{ok:!1,error:"\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE\u90AE\u7BB1\uFF0C\u65E0\u6CD5\u6821\u9A8C\u57DF\u540D\u767D\u540D\u5355\u3002\u8BF7\u7ED9\u5E94\u7528\u5F00\u901A contact:user.email:readonly \u6743\u9650\u5E76\u53D1\u5E03\u7248\u672C\uFF0C\u6216\u628A PLAITCODE_AUTH_EMAIL_DOMAINS \u6E05\u7A7A\u3002"});return}if(!Re(d.identity.email,g.emailDomains??[])){i.record({event:"denied",ip:E(r),detail:`sso email not allowed: ${d.identity.email??"(none)"}`}),l(a,403,{ok:!1,error:"\u8FD9\u4E2A\u90AE\u7BB1\u4E0D\u5728\u5141\u8BB8\u7684\u57DF\u540D\u5185"});return}let f=d.identity,v=we(h.state,f);if(!v&&(f.email||f.openId||f.unionId)){let S=h.state.orgs[0];if(!S){l(a,409,{ok:!1,error:"\u670D\u52A1\u7AEF\u8FD8\u6CA1\u6709\u7EC4\u7EC7\uFF0C\u8BF7\u7BA1\u7406\u5458\u5148\u5EFA\u7EC4\u7EC7"});return}v=re(h.state,{orgId:S.id,name:f.name,role:"member",email:f.email,openId:f.openId,unionId:f.unionId}),v&&(await O(),i.record({event:"admin",ip:E(r),detail:`auto-provision ${f.email??f.openId??f.unionId}`}))}if(!v){i.record({event:"denied",ip:E(r),detail:"sso identity has no stable key"}),l(a,409,{ok:!1,error:"\u65E0\u6CD5\u5EFA\u7ACB\u6210\u5458\u8EAB\u4EFD\uFF1A\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE\u53EF\u7528\u4E8E\u8BC6\u522B\u8EAB\u4EFD\u7684\u6807\u8BC6\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458"});return}f.email&&!v.email&&(v.email=f.email,await O());let A=g.sessionTtlMs??720*6e4,w=Le(g.secret,{memberId:v.id,name:v.name,...d.identity.email?{email:d.identity.email}:{},exp:Date.now()+A});i.record({event:"login",ip:E(r),detail:v.name}),a.writeHead(302,{location:"/m","set-cookie":`plaitcode_session=${w}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(A/1e3)}`,"cache-control":"no-store"}),a.end();return}if(x==="/v1/auth/me"&&r.method==="GET"){let g=t.auth;if(!g){l(a,404,{ok:!1,error:"sso disabled"});return}let u=se(g.secret,ee(r.headers.cookie).plaitcode_session);if(!u){l(a,401,{ok:!1,error:"\u672A\u767B\u5F55"});return}l(a,200,{ok:!0,member:{id:u.memberId,name:u.name,email:u.email??null}});return}if(x==="/v1/auth/logout"&&r.method==="POST"){a.writeHead(200,{"content-type":"application/json; charset=utf-8","set-cookie":"plaitcode_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"}),a.end(JSON.stringify({ok:!0}));return}if(x==="/v1/devices/enroll"&&r.method==="POST"){if(!h){l(a,404,{ok:!1,error:"identity disabled"});return}if(t.selfEnroll===!1){l(a,403,{ok:!1,error:"self enrollment disabled"});return}let g=q(r),u=g?oe(h.state,g):void 0,d=u&&!u.revokedAt&&(u.expiresAt===void 0||Date.now()<=u.expiresAt)?u:void 0;if(!d){i.record({event:"denied",ip:E(r),detail:"enroll auth failed"}),l(a,403,{ok:!1,error:"\u9700\u8981\u7528\u5DF2\u767B\u8BB0\u7684\u8BBE\u5907\u4EE4\u724C\u8C03\u7528"});return}let f=await X(r);if(f===void 0){l(a,413,{ok:!1,error:"body too large"});return}let v={};if(f)try{v=JSON.parse(f)}catch{l(a,400,{ok:!1,error:"invalid json"});return}let A=ie(h.state,{memberId:d.memberId,name:String(v.name??"\u65B0\u8BBE\u5907"),platform:typeof v.platform=="string"?v.platform:void 0,channels:d.grants.map(w=>({channelId:w.channelId,role:w.role}))});if(!A){l(a,409,{ok:!1,error:"\u6210\u5458\u4E0D\u5B58\u5728"});return}await O(),i.record({event:"admin",ip:E(r),detail:`self-enroll ${A.device.name}`}),l(a,200,{ok:!0,device:{id:A.device.id,name:A.device.name,grants:A.device.grants},token:A.token});return}if(x.startsWith("/v1/admin/")){if(!h||!M){l(a,404,{ok:!1,error:"admin api disabled"});return}if(!K(r.headers["x-plaitcode-admin"])){i.record({event:"denied",ip:E(r),detail:"admin auth failed"}),l(a,403,{ok:!1,error:"admin denied"});return}let g=r.method==="POST"?await X(r):"";if(g===void 0){l(a,413,{ok:!1,error:"body too large"});return}let u={};if(g)try{u=JSON.parse(g)}catch{l(a,400,{ok:!1,error:"invalid json"});return}if(x==="/v1/admin/state"&&r.method==="GET"){l(a,200,{ok:!0,identity:Ce(h.state)});return}if(x==="/v1/admin/orgs"&&r.method==="POST"){let d=ke(h.state,String(u.name??""));await O(),i.record({event:"admin",ip:E(r),detail:`org ${d.name}`}),l(a,200,{ok:!0,org:d});return}if(x==="/v1/admin/members"&&r.method==="POST"){let d=re(h.state,{orgId:String(u.orgId??""),name:String(u.name??""),role:u.role});if(!d){l(a,404,{ok:!1,error:"org not found"});return}await O(),i.record({event:"admin",ip:E(r),detail:`member ${d.name} (${d.role})`}),l(a,200,{ok:!0,member:d});return}if(x==="/v1/admin/devices"&&r.method==="POST"){let d=Array.isArray(u.channels)?u.channels:[],f=ie(h.state,{memberId:String(u.memberId??""),name:String(u.name??""),platform:typeof u.platform=="string"?u.platform:void 0,channels:d.filter(v=>!!v&&typeof v=="object").map(v=>({channelId:String(v.channelId??""),role:v.role}))});if(!f){l(a,404,{ok:!1,error:"member not found"});return}await O(),i.record({event:"admin",ip:E(r),detail:`device ${f.device.name} for ${f.device.memberId}`}),l(a,200,{ok:!0,device:{id:f.device.id,memberId:f.device.memberId,name:f.device.name,grants:f.device.grants},token:f.token});return}if(x==="/v1/admin/devices/revoke"&&r.method==="POST"){let d=Ie(h.state,String(u.deviceId??""));await O(),i.record({event:"admin",ip:E(r),detail:`revoke ${String(u.deviceId??"")} -> ${d}`}),l(a,d?200:404,{ok:d});return}l(a,404,{ok:!1,error:"not found"});return}if(r.method==="GET"&&N){l(a,200,{ok:!0,service:"plaitcode-relay",version:Ze,channels:m.size,uptime:Math.round(process.uptime())});return}if(!x.startsWith("/v1/")){l(a,404,{ok:!1,error:"not found"});return}if(r.method==="GET"&&x==="/v1/poll"){let g=k.get("channel")??"",u=j(r,g,"poll");if(!u.ok){i.record({event:"denied",channel:g.slice(0,32),ip:E(r),detail:u.reason}),l(a,u.status,{ok:!1,error:u.reason});return}let d=h?F(g):T(g,q(r));if(!d){l(a,403,{ok:!1,error:"channel denied"});return}d.ready&&await d.ready;let f=Number(k.get("since")??0)||0,v=Math.min(Math.max(Number(k.get("wait")??20)*1e3||2e4,0),n),A=()=>d.messages.filter(H=>H.seq>f),w=A();if(w.length||v===0){l(a,200,{ok:!0,messages:w.slice(-200),seq:d.seq});return}let S=!1,I=()=>{if(S)return;S=!0;let H=d.waiters.indexOf(I);H>=0&&d.waiters.splice(H,1),clearTimeout(L),!a.writableEnded&&l(a,200,{ok:!0,messages:A().slice(-200),seq:d.seq})},L=setTimeout(I,v);L.unref?.(),d.waiters.push(I),r.on("close",()=>{if(S)return;S=!0;let H=d.waiters.indexOf(I);H>=0&&d.waiters.splice(H,1),clearTimeout(L)});return}if(r.method==="POST"&&x==="/v1/publish"){let g=await X(r);if(!g){l(a,413,{ok:!1,error:"body too large"});return}let u;try{u=JSON.parse(g)}catch{l(a,400,{ok:!1,error:"invalid json"});return}let d=typeof u.channel=="string"?u.channel:"",f=typeof u.id=="string"?u.id.slice(0,80):"",v=typeof u.from=="string"?u.from.slice(0,80):"",A=typeof u.envelope?.iv=="string"?u.envelope.iv:"",w=typeof u.envelope?.ct=="string"?u.envelope.ct:"";if(!f||!v||!A||!w||w.length>64*1024){l(a,400,{ok:!1,error:"invalid message"});return}let S=j(r,d,"publish");if(!S.ok){i.record({event:"denied",channel:d.slice(0,32),ip:E(r),detail:S.reason}),l(a,S.status,{ok:!1,error:S.reason});return}let I=h?F(d):T(d,q(r));if(!I){i.record({event:"denied",channel:d.slice(0,32),ip:E(r),detail:"channel denied"}),l(a,403,{ok:!1,error:"channel denied"});return}if(I.ready&&await I.ready,I.seen.has(f)){i.record({event:"publish",channel:d,device:v,message:f,ip:E(r),detail:"duplicate"}),l(a,200,{ok:!0,duplicate:!0,seq:I.seq});return}I.seq+=1,I.seen.add(f),i.record({event:"publish",channel:d,device:v,message:f,ip:E(r),bytes:w.length}),I.seen.size>e*4&&(I.seen=new Set([...I.seen].slice(-e*2)));let L={seq:I.seq,id:f,from:v,envelope:{iv:A,ct:w},at:Date.now()};I.messages.push(L),p.append(d,{seq:L.seq,id:L.id,from:L.from,iv:A,ct:w,at:L.at}),I.messages.length>e&&(I.messages=I.messages.slice(-e));for(let H of[...I.waiters])H();l(a,200,{ok:!0,seq:I.seq});return}if(x==="/v1/presence"){let g=q(r),u=k.get("channel")??"",d;if(r.method==="POST"){let w=await X(r);if(!w){l(a,413,{ok:!1,error:"body too large"});return}let S;try{S=JSON.parse(w)}catch{l(a,400,{ok:!1,error:"invalid json"});return}u=typeof S.channel=="string"?S.channel:"",d=S.device}let f=j(r,u,"presence");if(!f.ok){i.record({event:"denied",channel:u.slice(0,32),ip:E(r),detail:f.reason}),l(a,f.status,{ok:!1,error:f.reason});return}let v=h?F(u):T(u,g);if(!v){l(a,403,{ok:!1,error:"channel denied"});return}if(d){let w=f.deviceId??(typeof d.id=="string"?d.id.slice(0,80):"");if(!w){l(a,400,{ok:!1,error:"invalid device"});return}v.presence.set(w,{name:f.member?`${f.member} \xB7 ${typeof d.name=="string"?d.name.slice(0,60):"\u8BBE\u5907"}`:typeof d.name=="string"?d.name.slice(0,120):w,platform:typeof d.platform=="string"?d.platform:"unknown",project:typeof d.project=="string"?d.project.slice(0,120):"",at:Date.now()})}let A=Date.now();for(let[w,S]of v.presence)A-S.at>tt&&v.presence.delete(w);l(a,200,{ok:!0,devices:[...v.presence.entries()].map(([w,S])=>({id:w,...S}))});return}l(a,404,{ok:!1,error:"not found"})})().catch(y=>{s(`[relay] \u8BF7\u6C42\u5904\u7406\u5931\u8D25\uFF1A${y instanceof Error?y.message:String(y)}`),a.writableEnded||l(a,500,{ok:!1,error:"internal error"})})});await new Promise((r,a)=>{R.once("error",a),R.listen(t.port??8787,t.host??"0.0.0.0",()=>{R.off("error",a),r()})});let _=R.address(),Z=_&&typeof _=="object"?_.port:t.port??8787;return s(`[relay] \u76D1\u542C ${t.host??"0.0.0.0"}:${Z}`),i.record({event:"startup",detail:`listen ${t.host??"0.0.0.0"}:${Z}`}),{port:Z,close:()=>new Promise(r=>{i.record({event:"shutdown"});for(let a of m.values())for(let y of[...a.waiters])y();R.close(()=>{Promise.all([i.flush(),p.flush()]).then(()=>r())}),setTimeout(()=>r(),1500).unref?.()})}}var je=require("node:dgram"),ze=require("node:http"),Fe=require("node:https"),qe=require("node:net");function Ke(t){let e=(t??"").trim();if(e)try{if(/^otlp\+https?:\/\//i.test(e))return{kind:"otlp",url:new URL(e.replace(/^otlp\+/i,""))};if(/^syslog\+tcp:\/\//i.test(e))return{kind:"syslog-tcp",url:new URL(e.replace(/^syslog\+tcp:/i,"http:"))};if(/^syslog:\/\//i.test(e))return{kind:"syslog",url:new URL(e.replace(/^syslog:/i,"http:"))};if(/^https?:\/\//i.test(e))return{kind:"webhook",url:new URL(e)}}catch{return}}function Ue(t,e,n){let o;try{o=t}catch{return}let s=Buffer.from(e,"utf8"),m=(o.protocol==="https:"?Fe.request:ze.request)(o,{method:"POST",headers:{"content-type":"application/json","content-length":String(s.length)},timeout:n},c=>{c.resume()});m.on("timeout",()=>m.destroy()),m.on("error",()=>{}),m.end(s)}function nt(t,e){let n=`${Date.now()}000000`;try{let o=JSON.parse(t);if(typeof o.ts=="string"){let s=Date.parse(o.ts);Number.isFinite(s)&&(n=`${s}000000`)}}catch{}return JSON.stringify({resourceLogs:[{resource:{attributes:[{key:"service.name",value:{stringValue:"plaitcode-relay"}},{key:"host.name",value:{stringValue:e}}]},scopeLogs:[{scope:{name:"plaitcode.audit"},logRecords:[{timeUnixNano:n,severityText:"INFO",body:{stringValue:t}}]}]}]})}function Je(t,e={}){let n=e.hostname??"plaitcode-relay";if(t.kind==="webhook")return{send:c=>Ue(t.url,c,5e3),close:()=>{}};if(t.kind==="otlp")return{send:c=>Ue(t.url,nt(c,n),5e3),close:()=>{}};let o=t.url.hostname,s=Number(t.url.port||514);if(t.kind==="syslog"){let c=(0,je.createSocket)("udp4");return c.on("error",()=>{}),c.unref?.(),{send:p=>{let b=`<14>1 - ${n} plaitcode-relay - AUDIT - ${p}`;try{c.send(Buffer.from(b,"utf8"),s,o,()=>{})}catch{}},close:()=>{try{c.close()}catch{}}}}let i,m=()=>(i&&!i.destroyed||(i=(0,qe.connect)(s,o,()=>{}),i.on("error",()=>{i=void 0}),i.on("close",()=>{i=void 0}),i.unref?.()),i);return{send:c=>{let p=m();if(p)try{p.write(`<14>1 - ${n} plaitcode-relay - AUDIT - ${c}
`)}catch{i=void 0}},close:()=>{try{i?.destroy()}catch{}}}}var Ge=require("node:os"),Q=require("node:path");async function rt(){let t=Number(process.env.PLAITCODE_PORT??8787),e=process.env.PLAITCODE_HOST??"127.0.0.1",n=process.env.PLAITCODE_AUDIT??"/var/lib/plaitcode-relay/audit.jsonl",o=process.env.PLAITCODE_AUDIT_STDOUT!=="0",s=process.env.PLAITCODE_IDENTITY?.trim(),i=process.env.PLAITCODE_ADMIN_TOKEN?.trim()??"",m=process.env.PLAITCODE_HISTORY?.trim(),c=m==="-"?void 0:m||(n!=="-"?(0,Q.join)((0,Q.dirname)(n),"channels"):"/var/lib/plaitcode-relay/channels"),p=s?{state:await Te(s)??ve(),path:s}:void 0;p&&(console.log(`[relay] \u8EAB\u4EFD\u6A21\u5F0F\uFF1A${p.state.orgs.length} \u7EC4\u7EC7 / ${p.state.members.length} \u6210\u5458 / ${p.state.devices.length} \u8BBE\u5907`),i||console.log("[relay] \u8B66\u544A\uFF1A\u6CA1\u8BBE PLAITCODE_ADMIN_TOKEN\uFF0C\u7BA1\u7406\u63A5\u53E3\u4E0D\u53EF\u7528"));let b=Ke(process.env.PLAITCODE_AUDIT_SINK),T=b?Je(b,{hostname:(0,Ge.hostname)()}):void 0;b&&console.log(`[relay] \u5BA1\u8BA1\u5916\u9001\uFF1A${b.kind} \u2192 ${b.url.host}`);let P=process.env.PLAITCODE_FEISHU_APP_ID?.trim()??"",h=process.env.PLAITCODE_FEISHU_APP_SECRET?.trim()??"",M=process.env.PLAITCODE_AUTH_SECRET?.trim()??"",F=(process.env.PLAITCODE_PUBLIC_URL?.trim()||"https://plaitcode.com").replace(/\/+$/,""),j=P&&h?{appId:P,appSecret:h,redirectUri:`${F}/v1/auth/feishu/callback`,...process.env.PLAITCODE_FEISHU_AUTHORIZE?{endpoints:{authorize:process.env.PLAITCODE_FEISHU_AUTHORIZE}}:{},...process.env.PLAITCODE_FEISHU_TOKEN?{endpoints:{token:process.env.PLAITCODE_FEISHU_TOKEN}}:{},...process.env.PLAITCODE_FEISHU_USERINFO?{endpoints:{userinfo:process.env.PLAITCODE_FEISHU_USERINFO}}:{}}:void 0,O=j&&M&&p?{config:j,secret:M,emailDomains:(process.env.PLAITCODE_AUTH_EMAIL_DOMAINS??"").split(",").map(_=>_.trim()).filter(Boolean)}:void 0;O?console.log("[relay] \u98DE\u4E66\u767B\u5F55\u5DF2\u542F\u7528"):P&&console.log("[relay] \u8B66\u544A\uFF1A\u98DE\u4E66\u767B\u5F55\u9700\u8981 PLAITCODE_AUTH_SECRET \u4E0E\u8EAB\u4EFD\u5E93\uFF08PLAITCODE_IDENTITY\uFF09");let K=await Ne({port:Number.isFinite(t)&&t>0?t:8787,host:e,log:_=>console.log(_),...p?{identity:p}:{},...i?{adminToken:i}:{},...O?{auth:O}:{},...c?{historyDir:c}:{},...process.env.PLAITCODE_SELF_ENROLL==="0"?{selfEnroll:!1}:{},audit:{...n&&n!=="-"?{path:n}:{},sink:(_=>{o&&console.log(`[audit] ${_}`),T?.send(_)}),includeIp:process.env.PLAITCODE_AUDIT_IP!=="0",maxBytes:Number(process.env.PLAITCODE_AUDIT_MAX_BYTES??20*1024*1024),keep:Number(process.env.PLAITCODE_AUDIT_KEEP??5)}});console.log(`[relay] ready on http://${e}:${K.port}`);let R=_=>{console.log(`[relay] ${_}\uFF0C\u6B63\u5728\u5173\u95ED`),T?.close(),K.close().then(()=>process.exit(0))};process.on("SIGTERM",()=>R("SIGTERM")),process.on("SIGINT",()=>R("SIGINT"))}rt().catch(t=>{console.error(`[relay] \u542F\u52A8\u5931\u8D25\uFF1A${t instanceof Error?t.message:String(t)}`),process.exit(1)});
