"use strict";var N=require("node:crypto"),Ze=require("node:http");var H=require("node:fs/promises"),be=require("node:path"),X=class{constructor(t={}){this.options=t;this.maxBytes=Math.max(4*1024,t.maxBytes??20*1024*1024),this.keep=Math.max(1,Math.min(t.keep??3,20)),this.includeIp=t.includeIp??!0}options;maxBytes;keep;includeIp;queue=Promise.resolve();written=0;record(t){let r={ts:(this.options.now?.()??new Date).toISOString(),event:t.event,...t.channel?{channel:t.channel}:{},...t.device?{device:t.device}:{},...t.message?{message:t.message}:{},...t.ip&&this.includeIp?{ip:t.ip}:{},...typeof t.bytes=="number"?{bytes:t.bytes}:{},...t.detail?{detail:t.detail}:{}},o=`${JSON.stringify(r)}
`;try{this.options.sink?.(o.trimEnd())}catch{}let d=this.options.path;d&&(this.queue=this.queue.then(()=>this.append(d,o)).catch(()=>{}))}async flush(){await this.queue.catch(()=>{})}async tail(t=200){let r=this.options.path;if(!r)return[];await this.flush();let o;try{o=await(0,H.readFile)(r,"utf8")}catch{return[]}let d=o.split(`
`).filter(p=>p.trim()),i=Math.max(1,Math.min(Math.floor(t),1e3)),g=[];for(let p of d.slice(-i))try{let f=JSON.parse(p);f&&typeof f=="object"&&g.push(f)}catch{}return g.reverse()}async append(t,r){let o=Buffer.byteLength(r);this.written===0&&(this.written=await(0,H.stat)(t).then(d=>d.size).catch(()=>0)),this.written+o>this.maxBytes&&(await this.rotate(t),this.written=0),await(0,H.mkdir)((0,be.dirname)(t),{recursive:!0}).catch(()=>{}),await(0,H.appendFile)(t,r,"utf8"),this.written+=o}async rotate(t){for(let r=this.keep;r>=1;r-=1){let o=r===1?t:`${t}.${r-1}`,d=`${t}.${r}`;await(0,H.rename)(o,d).catch(()=>{})}}};var L=require("node:fs/promises"),xe=require("node:path"),lt=/^[0-9a-f]{16,64}$/;function ye(e,t=500){if(!e)return{load:async()=>[],append:()=>{},flush:async()=>{}};let r=new Map,o=i=>lt.test(i)?(0,xe.join)(e,`${i}.jsonl`):void 0,d=i=>{let g=[];for(let p of i.split(`
`))if(p.trim())try{let f=JSON.parse(p);if(typeof f.seq!="number"||!Number.isFinite(f.seq)||typeof f.id!="string"||!f.id||typeof f.iv!="string"||typeof f.ct!="string")continue;g.push({seq:f.seq,id:f.id,from:typeof f.from=="string"?f.from:"",iv:f.iv,ct:f.ct,at:typeof f.at=="number"&&Number.isFinite(f.at)?f.at:0})}catch{}return g.sort((p,f)=>p.seq-f.seq)};return{async load(i){let g=o(i);if(!g)return[];let p;try{p=await(0,L.readFile)(g,"utf8")}catch{return[]}let f=d(p),k=t>0?f.slice(-t):f;if(f.length>k.length*2&&k.length>0){let A=k.map(v=>JSON.stringify(v)).join(`
`),P=`${g}.tmp`;await(0,L.writeFile)(P,`${A}
`,"utf8").catch(()=>{}),await(0,L.rename)(P,g).catch(()=>{})}return k},append(i,g){let p=o(i);if(!p)return;let f=`${JSON.stringify(g)}
`,A=(r.get(i)??Promise.resolve()).then(async()=>{await(0,L.mkdir)(e,{recursive:!0}).catch(()=>{}),await(0,L.appendFile)(p,f,"utf8")}).catch(()=>{});r.set(i,A),A.then(()=>{r.get(i)===A&&r.delete(i)})},async flush(){await Promise.all([...r.values()])}}}var ct={approval:"\u9700\u8981\u4F60\u6279\u51C6",done:"\u4EFB\u52A1\u5B8C\u6210",blocked:"\u672A\u6267\u884C"},pt={approval:"\u23F3",done:"\u2705",blocked:"\u26A0\uFE0F"};function ut(e,t){return[`${pt[e.kind]} PlaitCode \xB7 ${ct[e.kind]}`,e.title?`\u4E8B\u9879\uFF1A${e.title}`:"",e.summary?`\u8BE6\u60C5\uFF1A${e.summary}`:"",e.source?`\u6765\u81EA\uFF1A${e.source}`:"",t?`\u6253\u5F00\uFF1A${t}`:""].filter(Boolean).join(`
`)}async function ke(e,t,r,o=5e3){if(!/^https:\/\//i.test(e))return{ok:!1,error:"webhook \u5FC5\u987B\u662F https \u5730\u5740"};try{let d=await fetch(e,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({msg_type:"text",content:{text:ut(t,r)}}),signal:AbortSignal.timeout(o)});if(!d.ok)return{ok:!1,error:`HTTP ${d.status}`};let i=await d.json().catch(()=>{}),g=i?.code??i?.StatusCode??0;return g!==0?{ok:!1,error:i?.msg??`code ${g}`}:{ok:!0}}catch(d){return{ok:!1,error:d instanceof Error?d.message:String(d)}}}var we="plaitcode/channel/1:",Se="plaitcode/relay/1:",Ie="plaitcode/enc/1:";function Ce(e){let t=e.relayHost.replace(/[<>&"]/g,""),r=e.sessionAuth===!0;return`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f1115">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="PlaitCode">
<meta name="mobile-web-app-capable" content="yes">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon.svg">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data: 'self'; manifest-src 'self'; worker-src 'self'">
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
  .approval { margin:0 0 12px; padding:10px 12px; border-radius:12px; font-size:14px;
    background:rgba(248,113,113,.10); border:1px solid rgba(248,113,113,.5); }
  .approval.safe { background:var(--panel2); border-color:var(--line); }
  .approval .title { font-weight:600; margin-bottom:4px; }
  .approval .detail { font-size:12px; color:var(--muted); white-space:pre-wrap; word-break:break-word; }
  .approval .row { display:flex; gap:8px; margin-top:10px; }
  .approval .row button { flex:1; padding:9px 10px; }
  .approval .row .allow { background:var(--ok); border-color:var(--ok); color:#06231a; }
  .approval .row .deny { color:var(--bad); border-color:rgba(248,113,113,.5); }
  .controls { flex:1 0 100%; display:flex; gap:6px; overflow-x:auto; align-items:center; font-size:12px; color:var(--muted); }
  .controls .chip { padding:5px 10px; border-radius:999px; border:1px solid var(--line); color:var(--muted);
    background:var(--panel2); font-size:12px; white-space:nowrap; flex:0 0 auto; }
  .controls .chip.on { border-color:var(--brand); color:var(--brand); }
  .controls .chip.stop { color:var(--bad); border-color:rgba(248,113,113,.5); }
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
  <span class="meta" id="meta">${t}</span>
</header>
<div class="board" id="board" style="display:none"></div>
<main id="main"><div class="empty">\u6B63\u5728\u8BFB\u53D6\u9891\u9053\u2026</div></main>
<footer id="footer" style="display:none">
  <div class="controls" id="controls"></div>
  <div class="assign" id="assign"></div>
  <textarea id="input" rows="1" placeholder="\u4EE5\u7532\u65B9\u8EAB\u4EFD\u8BF4\u4E00\u53E5\u8BDD\uFF08Enter \u53D1\u9001\uFF09"></textarea>
  <button class="primary" id="send">\u53D1\u9001</button>
</footer>
<script>
(function () {
  var KEY_STORE = 'plaitcode.relay.key';
  var SESSION_AUTH = ${r?"true":"false"};
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
    return Promise.all([digest('${we}'), digest('${Se}'), digest('${Ie}')])
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

  var STATUS_LABEL = { question:'\u7B49\u4F60\u56DE\u590D', blocked:'\u672A\u6267\u884C', running:'\u8FDB\u884C\u4E2D', open:'\u5F85\u63A5', done:'\u5DF2\u5B8C\u6210' };  var STATUS_ORDER = ['question', 'blocked', 'running', 'open', 'done'];
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
    var next = JSON.stringify([state.messages, state.question, approvals.length, approvals[0] && approvals[0].id]);
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
    renderApprovals();
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

  var APPROVAL_TTL_MS = 3 * 60 * 1000;
  var approvals = [];
  /** \u7535\u8111\u4E0A\u771F\u5B9E\u751F\u6548\u7684\u8BBE\u7F6E\uFF08\u7531\u7535\u8111\u5E7F\u64AD\u8FC7\u6765\uFF0C\u4E0D\u662F\u624B\u673A\u731C\u7684\uFF09\u3002 */
  var remote = { preset: '', steps: 0, running: false };

  var PRESETS = [
    { id:'askAll', label:'\u6BCF\u6B21\u8BE2\u95EE' },
    { id:'review', label:'\u53EA\u5BA1\u6838\u53D8\u66F4' },
    { id:'autopilot', label:'\u81EA\u52A8\u6267\u884C' },
    { id:'full', label:'\u5B8C\u5168\u8BBF\u95EE' }
  ];

  /** \u53D1\u4E00\u6761\u63A7\u5236\u6307\u4EE4\u7ED9\u7535\u8111\uFF08\u6539\u6863\u4F4D / \u6539\u6B65\u6570 / \u505C\u6B62 / \u67E5\u72B6\u6001\uFF09\u3002 */
  function sendControl(payload) {
    var messageId = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var message = Object.assign({
      kind: 'control', id: messageId, at: Date.now(),
      from: { id: deviceId, name: '\u624B\u673A \xB7 \u6D4F\u89C8\u5668', platform: 'android', project: 'mobile', version: 'web' }
    }, payload);
    return seal(messageId, JSON.stringify(message))
      .then(function (envelope) { return post('/v1/publish', { channel: keys.channel, id: messageId, from: deviceId, envelope: envelope }); })
      .then(function (result) {
        if (!result.ok) { alert(result.error || '\u6CA1\u53D1\u51FA\u53BB'); return false; }
        return true;
      });
  }

  function renderControls() {
    var box = document.getElementById('controls');
    box.textContent = '';
    box.appendChild(el('span', 'label', '\u6743\u9650'));
    PRESETS.forEach(function (preset) {
      var chip = el('button', 'chip' + (remote.preset === preset.id ? ' on' : ''), preset.label);
      chip.type = 'button';
      chip.onclick = function () {
        if (remote.preset === preset.id) return;
        // \u5148\u4E50\u89C2\u663E\u793A\uFF0C\u7535\u8111\u56DE\u4F20\u7684\u771F\u5B9E\u503C\u4F1A\u8986\u76D6\uFF08\u4F01\u4E1A\u7B56\u7565\u53EF\u80FD\u628A\u5B83\u6536\u7D27\uFF09
        remote.preset = preset.id;
        renderControls();
        sendControl({ action: 'preset', preset: preset.id });
      };
      box.appendChild(chip);
    });
    box.appendChild(el('span', 'label', '\u6B65\u6570'));
    [12, 24, 48].forEach(function (steps) {
      var chip = el('button', 'chip' + (remote.steps === steps ? ' on' : ''), String(steps));
      chip.type = 'button';
      chip.onclick = function () { sendControl({ action: 'steps', steps: steps }); };
      box.appendChild(chip);
    });
    if (remote.running) {
      var stop = el('button', 'chip stop', '\u505C\u6B62\u6267\u884C');
      stop.type = 'button';
      stop.onclick = function () {
        if (!confirm('\u8981\u4E2D\u6B62\u7535\u8111\u4E0A\u6B63\u5728\u8DD1\u7684\u4EFB\u52A1\u5417\uFF1F')) return;
        sendControl({ action: 'stop' });
      };
      box.appendChild(stop);
    }
  }

  /** \u7535\u8111\u5E7F\u64AD\u8FC7\u6765\u7684\u771F\u5B9E\u72B6\u6001\u3002 */
  function acceptControl(message) {
    if (message.action !== 'state') return;
    remote = {
      preset: message.preset || '',
      steps: message.steps || 0,
      running: message.running === true,
    };
    renderControls();
  }

  /** \u6536\u5230\u7684\u6388\u6743\u5361\uFF1Bphase=decision \u8868\u793A\u522B\u4EBA\u5DF2\u7ECF\u5904\u7406\uFF0C\u64A4\u6389\u672C\u5730\u8FD9\u5F20\u3002 */
  function acceptApproval(message) {
    if (message.phase !== 'request') {
      approvals = approvals.filter(function (item) { return item.id !== message.id; });
      return;
    }
    if (message.from && message.from.id === deviceId) return;
    if (approvals.some(function (item) { return item.id === message.id; })) return;
    approvals.push(message);
    if (approvals.length > 8) approvals = approvals.slice(-8);
  }

  /** \u8D85\u8FC7 3 \u5206\u949F\u7684\u5361\u4E0D\u518D\u663E\u793A\uFF08\u7535\u8111\u7AEF\u4E5F\u65E9\u5C31\u81EA\u52A8\u62D2\u7EDD\u4E86\uFF09\u3002 */
  function freshApprovals() {
    var now = Date.now();
    approvals = approvals.filter(function (item) { return now - (item.at || 0) < APPROVAL_TTL_MS; });
    return approvals;
  }

  /** \u5728\u624B\u673A\u4E0A\u70B9\u300C\u5141\u8BB8 / \u62D2\u7EDD\u300D\uFF1A\u628A\u51B3\u5B9A\u52A0\u5BC6\u9001\u56DE\u7535\u8111\uFF0C\u7535\u8111\u636E\u6B64\u7ED3\u7B97\u3002 */
  function decide(id, allow, button) {
    button.disabled = true;
    var messageId = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var message = {
      kind: 'approval', id: id, phase: 'decision', allow: allow, at: Date.now(),
      title: '', summary: '', detail: '', risk: 'read',
      from: { id: deviceId, name: '\u624B\u673A \xB7 \u6D4F\u89C8\u5668', platform: 'android', project: 'mobile', version: 'web' }
    };
    seal(messageId, JSON.stringify(message))
      .then(function (envelope) { return post('/v1/publish', { channel: keys.channel, id: messageId, from: deviceId, envelope: envelope }); })
      .then(function (result) {
        if (!result.ok) { alert(result.error || '\u6CA1\u53D1\u51FA\u53BB'); button.disabled = false; return; }
        approvals = approvals.filter(function (item) { return item.id !== id; });
        signature = '';
        render({ connected:true, messages: messages, question: questionFor(messages) });
      })
      .catch(function () { alert('\u7F51\u7EDC\u6CA1\u8FDE\u4E0A'); button.disabled = false; });
  }

  function renderApprovals() {
    freshApprovals().forEach(function (approval) {
      var risky = approval.risk === 'command' || approval.risk === 'dangerous';
      var card = el('div', 'approval' + (risky ? '' : ' safe'));
      card.appendChild(el('div', 'title', approval.title || '\u9700\u8981\u4F60\u6279\u51C6'));
      card.appendChild(el('div', 'detail', (approval.summary || '') + (approval.detail ? '\\n' + approval.detail : '')));
      var row = el('div', 'row');
      var deny = el('button', 'deny', '\u62D2\u7EDD');
      deny.onclick = function () { decide(approval.id, false, deny); };
      var allow = el('button', 'allow', '\u5141\u8BB8');
      allow.onclick = function () { decide(approval.id, true, allow); };
      row.appendChild(deny);
      row.appendChild(allow);
      card.appendChild(row);
      main.appendChild(card);
    });
  }

  /**
   * \u672A\u767B\u5F55 \u2192 \u8DF3\u98DE\u4E66\u767B\u5F55\u3002
   *
   * \u8FD9\u4E00\u6B65\u662F"\u626B\u7801\u4E00\u6B21\u8D70\u5B8C"\u7684\u5173\u952E\uFF1A\u5BC6\u94A5\u5DF2\u7ECF\u5B58\u5728 localStorage \u91CC\uFF0C
   * \u767B\u5F55\u56DE\u6765\u843D\u5728 /m \u4F1A\u81EA\u5DF1\u63A5\u7740\u7528\uFF0C\u4E0D\u9700\u8981\u7528\u6237\u518D\u7C98\u4E00\u904D\u914D\u5BF9\u4FE1\u606F\u3002
   * \u7528 sessionStorage \u8BB0\u8D26\uFF1A\u4E07\u4E00 SSO \u6CA1\u914D\u597D\uFF08\u8FD4\u56DE 404\uFF09\uFF0C\u4E0D\u8BB8\u65E0\u9650\u8DF3\u3002
   */
  var loginAttempted = false;
  function redirectToLogin() {
    if (loginAttempted) return false;
    try {
      if (sessionStorage.getItem('plaitcode.loginRedirect') === '1') {
        loginAttempted = true;
        return false;
      }
    } catch (error) {}
    loginAttempted = true;
    say('\u9700\u8981\u5148\u7528\u98DE\u4E66\u767B\u5F55\uFF0C\u6B63\u5728\u8DF3\u8F6C\u2026');
    try { sessionStorage.setItem('plaitcode.loginRedirect', '1'); } catch (error) {}
    setTimeout(function () { location.replace('/v1/auth/feishu/start'); }, 400);
    return true;
  }

  /** \u5148\u786E\u8BA4\u767B\u5F55\u6001\uFF1A\u6CA1\u6709\u5C31\u76F4\u63A5\u53BB\u767B\u5F55\uFF0C\u522B\u7B49\u8F6E\u8BE2 401 \u624D\u53D1\u73B0\u3002 */
  function ensureSession() {
    if (!SESSION_AUTH) return Promise.resolve(true);
    return fetch('/v1/auth/me', { credentials: 'same-origin' })
      .then(function (r) {
        if (r.ok) {
          try { sessionStorage.removeItem('plaitcode.loginRedirect'); } catch (error) {}
          return true;
        }
        if (r.status === 401) return false;
        // 404 = \u670D\u52A1\u7AEF\u6CA1\u5F00 SSO\uFF1B\u8FD9\u79CD\u60C5\u51B5\u4E0B\u522B\u8DF3\uFF0C\u5426\u5219\u4F1A\u8DF3\u5230 404
        return true;
      })
      .catch(function () { return true; });
  }

  function poll() {
    if (busy) return;
    busy = true;
    var url = '/v1/poll?channel=' + encodeURIComponent(keys.channel) + '&since=' + since + '&wait=20';
    fetch(url, { credentials:'same-origin', headers: authHeaders() })
      .then(function (r) {
        if (r.status === 401) {
          if (redirectToLogin()) throw new Error('\u6B63\u5728\u8DF3\u8F6C\u767B\u5F55');
          throw new Error(SESSION_AUTH ? '\u767B\u5F55\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u7528\u98DE\u4E66\u767B\u5F55' : '\u9700\u8981\u767B\u5F55\u624D\u80FD\u770B\u8FD9\u4E2A\u9891\u9053');
        }
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
              if (!message) return;
              if (message.kind === 'approval') { acceptApproval(message); return; }
              if (message.kind === 'control') { acceptControl(message); return; }
              if (message.kind !== 'group') return;
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
      return ensureSession().then(function (loggedIn) {
        if (!loggedIn) { redirectToLogin(); return; }
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
        // \u8FDE\u4E0A\u5C31\u95EE\u4E00\u6B21\u7535\u8111\u7684\u771F\u5B9E\u8BBE\u7F6E\uFF1A\u5426\u5219\u754C\u9762\u4E0A\u7684\u6743\u9650/\u6B65\u6570\u662F\u7A7A\u7684
        setTimeout(function () { sendControl({ action: 'state' }); }, 800);
        renderControls();
        document.addEventListener('visibilitychange', function () {
          if (!document.hidden) { sendControl({ action: 'state' }); poll(); }
        });
      });
    }).catch(function () { say('\u6D4F\u89C8\u5668\u4E0D\u652F\u6301 WebCrypto\uFF0C\u65E0\u6CD5\u52A0\u5BC6'); });
  }

  var fromHash = null;
  var hash = location.hash || '';
  var hashMatch = /[#&]k=([^&]+)/.exec(hash);
  if (hashMatch) fromHash = decodeURIComponent(hashMatch[1]);
  var stored = localStorage.getItem(KEY_STORE);
  if (fromHash && fromHash.length >= 16) {
    localStorage.setItem(KEY_STORE, fromHash);
    // \u91CD\u65B0\u626B\u4E86\u4E00\u6B21\u7801 = \u7528\u6237\u4E3B\u52A8\u91CD\u6765\uFF0C\u5141\u8BB8\u518D\u8DF3\u4E00\u6B21\u767B\u5F55
    try { sessionStorage.removeItem('plaitcode.loginRedirect'); } catch (error) {}
    loginAttempted = false;
    boot(fromHash);
  } else if (stored && stored.length >= 16) {
    boot(stored);
  } else {
    joinForm('');
  }

  // \u53EF\u5B89\u88C5\uFF1A\u6CE8\u518C service worker\uFF08\u5B83\u4E0D\u7ECF\u624B /v1/\uFF0C\u53EA\u8D1F\u8D23\u8BA9\u9875\u9762\u80FD\u88C5\u5230\u4E3B\u5C4F\u5E55\uFF09
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }
})();
</script>
</body>
</html>`}function Z(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}var Ee=`
  :root {
    /* \u95F4\u8DDD\uFF1A4 \u7684\u500D\u6570\uFF0C\u53EA\u7559\u516B\u6863 */
    --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:24px; --s6:32px; --s7:48px; --s8:64px; --s9:96px;
    /* \u5706\u89D2\uFF1A\u5BB9\u5668 / \u63A7\u4EF6 / \u5FBD\u6807\uFF0C\u5916\u5927\u5185\u5C0F */
    --r-lg:14px; --r-md:10px; --r-sm:6px;
    /* \u5B57\u53F7\uFF1A\u4E94\u6863 */
    --fs-hero:40px; --fs-h2:22px; --fs-h3:16px; --fs-body:14px; --fs-sm:13px; --fs-xs:12px;
    /* \u989C\u8272 */
    --bg:#0f1115; --surface:#15181f; --surface-2:#1b1f27;
    --line:rgba(255,255,255,.10); --line-strong:rgba(255,255,255,.18);
    --text:rgba(255,255,255,.95); --text-2:rgba(255,255,255,.64); --text-3:rgba(255,255,255,.42);
    --accent:#4c9aff; --accent-ink:#06121f; --ok:#34d399; --warn:#f0b429; --bad:#f87171;
    --container:1120px; --nav-h:56px;
  }
  *, *::before, *::after { box-sizing:border-box; }
  html { -webkit-text-size-adjust:100%; }
  body { margin:0; background:var(--bg); color:var(--text);
    font:var(--fs-body)/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing:antialiased; }
  h1, h2, h3, p { margin:0; }
  a { color:var(--accent); text-decoration:none; }
  a:hover { text-decoration:underline; }
  code, .mono { font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:var(--fs-xs); }
  :focus-visible { outline:2px solid var(--accent); outline-offset:2px; border-radius:var(--r-sm); }
  .skip { position:absolute; left:-9999px; }
  .skip:focus { left:var(--s4); top:var(--s4); z-index:99; padding:var(--s2) var(--s3);
    background:var(--surface-2); border:1px solid var(--line-strong); border-radius:var(--r-md); }
  .wrap { max-width:var(--container); margin:0 auto; padding:0 var(--s5); }
  .icon { width:20px; height:20px; flex:0 0 auto; stroke:currentColor; stroke-width:1.5;
    stroke-linecap:round; stroke-linejoin:round; fill:none; }
  .icon-sm { width:16px; height:16px; }

  /* \u6309\u94AE\uFF1A32px \u9AD8\uFF08\u9F20\u6807\uFF09\uFF0C\u89E6\u63A7\u573A\u666F\u81EA\u52A8\u6DA8\u5230 40px */
  .btn { display:inline-flex; align-items:center; justify-content:center; gap:var(--s2);
    min-height:32px; padding:0 var(--s3); border-radius:var(--r-md);
    border:1px solid var(--line-strong); background:var(--surface-2); color:var(--text);
    font:inherit; font-weight:600; font-size:var(--fs-sm); white-space:nowrap; cursor:pointer;
    transition:background-color .16s ease-out, border-color .16s ease-out; }
  .btn:hover { background:#232833; text-decoration:none; }
  .btn-primary { background:var(--accent); border-color:var(--accent); color:var(--accent-ink); }
  .btn-primary:hover { background:#63a9ff; border-color:#63a9ff; }
  .btn-ghost { background:transparent; border-color:transparent; color:var(--text-2); }
  .btn-ghost:hover { background:var(--surface-2); color:var(--text); }
  .btn-danger { background:transparent; border-color:rgba(248,113,113,.45); color:var(--bad); }
  .btn-danger:hover { background:rgba(248,113,113,.10); }
  .btn-lg { min-height:40px; padding:0 var(--s4); font-size:var(--fs-body); }
  .btn[disabled] { opacity:.45; cursor:not-allowed; }
  @media (pointer:coarse) { .btn { min-height:40px; } }

  /* \u5FBD\u6807 / \u72B6\u6001\u70B9 */
  .tag { display:inline-flex; align-items:center; gap:var(--s1); padding:0 var(--s2);
    height:20px; border-radius:var(--r-sm); border:1px solid var(--line);
    font-size:var(--fs-xs); color:var(--text-2); white-space:nowrap; }
  .tag-ok { color:var(--ok); border-color:rgba(52,211,153,.40); }
  .tag-bad { color:var(--bad); border-color:rgba(248,113,113,.40); }
  .tag-warn { color:var(--warn); border-color:rgba(240,180,41,.40); }
  .dot { width:6px; height:6px; border-radius:50%; background:currentColor; flex:0 0 auto; }

  /* \u5BFC\u822A */
  .nav { position:sticky; top:0; z-index:10; height:var(--nav-h);
    background:rgba(15,17,21,.86); backdrop-filter:blur(12px); border-bottom:1px solid var(--line); }
  .nav .inner { max-width:var(--container); margin:0 auto; padding:0 var(--s5); height:100%;
    display:flex; align-items:center; gap:var(--s5); }
  .brand { display:inline-flex; align-items:center; gap:var(--s2); color:var(--text); font-weight:600; }
  .brand:hover { text-decoration:none; }
  .brand img { width:24px; height:24px; border-radius:var(--r-sm); }
  .nav-links { display:flex; align-items:center; gap:var(--s5); font-size:var(--fs-sm); }
  .nav-links a { color:var(--text-2); }
  .nav-links a:hover { color:var(--text); text-decoration:none; }
  .nav-actions { margin-left:auto; display:flex; align-items:center; gap:var(--s2); }
  @media (max-width:840px) { .nav-links { display:none; } }

  /* \u9875\u9762\u7ED3\u6784 */
  .section { padding:var(--s9) 0; border-top:1px solid var(--line); }
  .section-head { max-width:680px; margin-bottom:var(--s7); }
  .eyebrow { font-size:var(--fs-xs); letter-spacing:.08em; text-transform:uppercase; color:var(--text-3); margin-bottom:var(--s2); }
  .section h2 { font-size:var(--fs-h2); line-height:1.3; font-weight:600; letter-spacing:-.2px; }
  .section .lede { margin-top:var(--s2); color:var(--text-2); }
  .grid-3 { display:grid; gap:var(--s4); grid-template-columns:repeat(3, minmax(0,1fr)); }
  .grid-2 { display:grid; gap:var(--s7); grid-template-columns:repeat(2, minmax(0,1fr)); align-items:start; }
  @media (max-width:840px) { .grid-3, .grid-2 { grid-template-columns:1fr; } .section { padding:var(--s8) 0; } }

  .card { border:1px solid var(--line); border-radius:var(--r-lg); background:var(--surface); padding:var(--s5); }
  .card h3 { display:flex; align-items:center; gap:var(--s2); font-size:var(--fs-h3); font-weight:600; }
  .card h3 .icon { color:var(--accent); }
  .card p { margin-top:var(--s2); color:var(--text-2); font-size:var(--fs-sm); }

  /* \u8868\u683C\uFF1A\u53EA\u9760 1px \u4E0B\u8FB9\u7EBF\uFF0C\u4E0D\u52A0\u6591\u9A6C\u7EB9 */
  table { width:100%; border-collapse:collapse; font-size:var(--fs-sm); }
  th { text-align:left; font-weight:500; color:var(--text-3); font-size:var(--fs-xs);
    padding:var(--s2) var(--s3); border-bottom:1px solid var(--line); white-space:nowrap; }
  td { padding:var(--s3); border-bottom:1px solid var(--line); vertical-align:middle; }
  tr:last-child td { border-bottom:0; }
  td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }

  footer.site { border-top:1px solid var(--line); padding:var(--s7) 0 var(--s6); color:var(--text-2); font-size:var(--fs-sm); }
  .foot-cols { display:grid; gap:var(--s6); grid-template-columns:repeat(4, minmax(0,1fr)); }
  .foot-cols h4 { margin:0 0 var(--s3); font-size:var(--fs-xs); color:var(--text-3); font-weight:500; }
  .foot-cols ul { list-style:none; margin:0; padding:0; display:grid; gap:var(--s2); }
  .foot-cols a { color:var(--text-2); }
  .foot-bottom { margin-top:var(--s7); padding-top:var(--s4); border-top:1px solid var(--line);
    display:flex; gap:var(--s4); flex-wrap:wrap; align-items:center; color:var(--text-3); font-size:var(--fs-xs); }
  @media (max-width:840px) { .foot-cols { grid-template-columns:repeat(2, minmax(0,1fr)); } }

  .banner { display:flex; gap:var(--s2); margin:var(--s4) 0; padding:var(--s3) var(--s4);
    border-radius:var(--r-md); font-size:var(--fs-sm);
    background:rgba(240,180,41,.10); border:1px solid rgba(240,180,41,.40); color:#f7d68a; }
  .empty { padding:var(--s7) var(--s4); text-align:center; color:var(--text-2); font-size:var(--fs-sm); }
  .empty .icon { width:32px; height:32px; color:var(--text-3); margin-bottom:var(--s3); }
  .empty b { display:block; color:var(--text); font-size:var(--fs-body); margin-bottom:var(--s1); }
  .empty p { max-width:420px; margin:0 auto; }
  tbody tr:hover td { background:rgba(255,255,255,.02); }
  .skeleton { height:14px; border-radius:var(--r-sm); background:var(--surface-2); }
  @media (prefers-reduced-motion:reduce) {
    * { transition:none !important; animation:none !important; scroll-behavior:auto !important; }
  }
`,ft={terminal:'<path d="M4 5h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/><path d="m6 9 2 2-2 2M10 13h4"/>',phone:'<rect x="6.5" y="3" width="7" height="14" rx="1.6"/><path d="M9 15h2"/>',shield:'<path d="M10 3 4.5 5v4.5c0 3.2 2.2 6.1 5.5 7 3.3-.9 5.5-3.8 5.5-7V5L10 3Z"/><path d="m7.6 9.8 1.7 1.7 3.1-3.2"/>',users:'<circle cx="7.5" cy="8" r="2.2"/><path d="M3.8 15.5c.4-2 1.9-3.2 3.7-3.2s3.3 1.2 3.7 3.2"/><path d="M13 6.3a2 2 0 0 1 0 3.7M14 12.6c1.4.2 2.4 1.3 2.7 2.9"/>',board:'<rect x="3.5" y="4" width="4.2" height="12" rx="1"/><rect x="8.8" y="4" width="4.2" height="8" rx="1"/><rect x="14.1" y="4" width="2.4" height="10" rx="1"/>',key:'<circle cx="7" cy="10" r="3"/><path d="M10 10h7M15 10v3M17.5 10v2"/>',server:'<rect x="3.5" y="4" width="13" height="5" rx="1.3"/><rect x="3.5" y="11" width="13" height="5" rx="1.3"/><path d="M6 6.5h.01M6 13.5h.01"/>',activity:'<path d="M3 11h3l2-5 3.5 9 2-4h3.5"/>'};function R(e,t="icon"){return`<svg class="${t}" viewBox="0 0 20 20" aria-hidden="true">${ft[e]??""}</svg>`}function Ae(e){let t=Z(e.relayHost),r=Z(e.installUrl),o=Z(e.repoUrl),d=[["\u5B89\u88C5\u6269\u5C55","\u5728 VS Code \u91CC\u88C5 PlaitCode\uFF0C\u6216\u7528 VSIX \u79BB\u7EBF\u5B89\u88C5\u3002"],["\u5F00\u4E00\u6761\u9891\u9053","\u6267\u884C\u300C\u65B0\u5EFA\u8DE8\u7F51\u9891\u9053\u300D\uFF0C\u62FF\u5230\u4E8C\u7EF4\u7801\u548C\u4E00\u884C\u914D\u5BF9\u4FE1\u606F\u3002"],["\u5F00\u59CB\u6307\u6325","\u624B\u673A\u626B\u7801\u8FDB\u56E2\u961F\u7FA4\uFF1B\u7B2C\u4E8C\u53F0\u7535\u8111\u7C98\u8D34\u914D\u5BF9\u4FE1\u606F\u5373\u53EF\u52A0\u5165\u3002"]],i=[["users","\u6307\u5B9A\u54EA\u53F0\u7535\u8111\u6267\u884C","\u9891\u9053\u5185\u6240\u6709\u8BBE\u5907\u5728\u7EBF\uFF0C\u4F46\u53EA\u6709\u88AB\u9009\u4E2D\u7684\u90A3\u53F0\u8DD1 agent\uFF0C\u5176\u4F59\u53EA\u8BB0\u72B6\u6001\u3002"],["board","\u4EFB\u52A1\u770B\u677F\u6309\u8BBE\u5907\u8BB0","\u7B49\u4F60\u56DE\u590D / \u672A\u6267\u884C / \u8FDB\u884C\u4E2D / \u5F85\u63A5 / \u5DF2\u5B8C\u6210\uFF0C\u8C01\u505A\u5230\u54EA\u4E00\u6B65\u4E00\u773C\u80FD\u770B\u5230\u3002"],["shield","\u6388\u6743\u5728\u4EFB\u610F\u4E00\u7AEF\u786E\u8BA4","\u8981\u8DD1\u547D\u4EE4\u3001\u8BFB\u654F\u611F\u6587\u4EF6\u65F6\uFF0C\u6388\u6743\u5361\u540C\u65F6\u51FA\u73B0\u5728\u7535\u8111\u548C\u624B\u673A\uFF0C\u8C01\u5148\u70B9\u7B97\u8C01\u3002"],["activity","\u65AD\u7EBF\u4E0D\u4E22\u4E0A\u4E0B\u6587","\u9891\u9053\u5386\u53F2\u843D\u76D8\u53EA\u5B58\u5BC6\u6587\uFF0C\u91CD\u542F\u3001\u6362\u8BBE\u5907\u3001\u6362\u7F51\u7EDC\u90FD\u80FD\u63A5\u4E0A\u3002"],["key","\u7AEF\u5230\u7AEF\u52A0\u5BC6","\u4E2D\u7EE7\u53EA\u8F6C\u53D1\u5BC6\u6587\uFF1B\u9891\u9053\u5BC6\u94A5\u53EA\u5B58\u5728\u4F60\u7684\u8BBE\u5907\u4E0A\uFF0C\u670D\u52A1\u7AEF\u4ECE\u672A\u6301\u6709\u3002"],["server","\u53EF\u4EE5\u81EA\u5DF1\u90E8\u7F72","\u96F6\u4F9D\u8D56\u5355\u6587\u4EF6 + systemd + nginx\uFF0C\u81EA\u5DF1\u7684\u57DF\u540D\u4E94\u5206\u949F\u4E0A\u7EBF\u3002"]],g=[["GitHub / GitLab PR","\u8BC4\u5BA1\u5DF2\u7ECF\u5199\u5B8C\u7684\u4EE3\u7801","\u4EE3\u7801\u8FD8\u6CA1\u5199\u51FA\u6765\u7684\u90A3\u4E00\u6B65\u6CA1\u4EBA\u7BA1"],["Live Share / Code With Me","\u4E24\u4E2A\u4EBA\u540C\u65F6\u7F16\u8F91\u540C\u4E00\u4EFD\u4EE3\u7801","\u8981\u6C42\u53CC\u65B9\u540C\u65F6\u5728\u7EBF"],["Replit / CodePen","\u6D4F\u89C8\u5668\u91CC\u7ACB\u523B\u770B\u5230\u7ED3\u679C","\u4E0D\u662F\u4F60\u7684\u771F\u5B9E\u4ED3\u5E93\u548C\u73AF\u5883"],["PlaitCode","\u5F02\u6B65\u4E0B\u8FBE\u9700\u6C42\uFF0C\u4EA4\u7ED9\u6307\u5B9A\u7684\u90A3\u53F0\u673A\u5668\u53BB\u5199","\u4E0D\u66FF\u4EE3\u4E0A\u9762\u4EFB\u4F55\u4E00\u4EF6"]];return`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0f1115">
<meta name="description" content="PlaitCode\uFF1AVS Code \u91CC\u7684\u591A\u4EBA\u591A\u673A AI \u7F16\u7A0B\u56E2\u961F\u3002\u624B\u673A\u53D1\u9700\u6C42\uFF0C\u6307\u5B9A\u7684\u90A3\u53F0\u7535\u8111\u6267\u884C\uFF0C\u7ED3\u679C\u56DE\u5230\u540C\u4E00\u6761\u9891\u9053\u3002">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: 'self'; connect-src 'self'; manifest-src 'self'">
<title>PlaitCode \xB7 \u624B\u673A\u6307\u6325\u4F60\u7684\u7535\u8111\u5199\u4EE3\u7801</title>
<style>${Ee}
  .hero { padding:var(--s7) 0 var(--s8); position:relative; }
  .hero::before { content:""; position:absolute; inset:-40% 20% auto; height:420px; pointer-events:none;
    background:radial-gradient(ellipse at 50% 0%, rgba(76,154,255,.16), transparent 68%); }
  .hero .wrap { position:relative; }
  .hero-grid { display:grid; gap:var(--s7); grid-template-columns:minmax(0,1fr) minmax(0,1fr); align-items:center; }
  .badge { display:inline-flex; align-items:center; gap:var(--s2); height:24px; padding:0 var(--s2);
    border-radius:var(--r-sm); border:1px solid var(--line); color:var(--text-2); font-size:var(--fs-xs); }
  .hero h1 { margin:var(--s4) 0 0; font-size:var(--fs-hero); line-height:1.15; letter-spacing:-1px; font-weight:600; }
  .hero .lede { margin-top:var(--s4); font-size:var(--fs-h3); line-height:1.6; color:var(--text-2); max-width:34em; }
  .hero .actions { display:flex; gap:var(--s3); flex-wrap:wrap; margin-top:var(--s6); align-items:center; }
  .hero .meta { display:flex; gap:var(--s4); flex-wrap:wrap; margin-top:var(--s5);
    color:var(--text-3); font-size:var(--fs-xs); }
  .hero .meta span { display:inline-flex; align-items:center; gap:var(--s1); }
  @media (max-width:960px) { .hero-grid { grid-template-columns:1fr; } .hero h1 { font-size:32px; } }

  /* \u4EA7\u54C1\u793A\u610F\u56FE\uFF1A\u7528\u771F\u5B9E\u7ED3\u6784\u753B\uFF0C\u4E0D\u653E\u4F1A\u8FC7\u65F6\u7684\u622A\u56FE */
  .window { border:1px solid var(--line-strong); border-radius:var(--r-lg); background:var(--surface); overflow:hidden; }
  .window-bar { display:flex; align-items:center; gap:var(--s2); height:36px; padding:0 var(--s3);
    border-bottom:1px solid var(--line); color:var(--text-3); font-size:var(--fs-xs); }
  .window-bar .dots { display:flex; gap:var(--s1); }
  .window-bar .dots i { width:8px; height:8px; border-radius:50%; background:var(--line-strong); display:block; }
  .window-body { padding:var(--s4); display:grid; gap:var(--s3); }
  .msg { display:flex; flex-direction:column; gap:var(--s1); max-width:90%; }
  .msg .who { font-size:var(--fs-xs); color:var(--text-3); display:flex; align-items:center; gap:var(--s2); }
  .msg .bubble { border:1px solid var(--line); background:var(--surface-2); border-radius:var(--r-md);
    padding:var(--s2) var(--s3); font-size:var(--fs-sm); line-height:1.5; }
  .msg.mine { align-self:flex-end; }
  .msg.mine .bubble { background:rgba(76,154,255,.14); border-color:rgba(76,154,255,.35); }
  .mock-assign { display:flex; gap:var(--s2); align-items:center; padding-top:var(--s3);
    border-top:1px dashed var(--line); color:var(--text-3); font-size:var(--fs-xs); flex-wrap:wrap; }
  .mock-chip { padding:0 var(--s2); height:22px; display:inline-flex; align-items:center;
    border-radius:var(--r-sm); border:1px solid var(--line); color:var(--text-2); }
  .mock-chip.on { border-color:var(--accent); color:var(--accent); }

  .steps { display:grid; gap:var(--s4); grid-template-columns:repeat(3, minmax(0,1fr)); }
  .step { border-top:1px solid var(--line-strong); padding-top:var(--s4); }
  .step .n { color:var(--text-3); font-size:var(--fs-xs); font-variant-numeric:tabular-nums; }
  .step h3 { margin-top:var(--s2); font-size:var(--fs-h3); font-weight:600; }
  .step p { margin-top:var(--s1); color:var(--text-2); font-size:var(--fs-sm); }
  @media (max-width:840px) { .steps { grid-template-columns:1fr; } }

  .quote { border-left:2px solid var(--accent); padding:var(--s1) 0 var(--s1) var(--s4);
    color:var(--text-2); font-size:var(--fs-sm); }
  .quote b { color:var(--text); }

  .code { border:1px solid var(--line); border-radius:var(--r-lg); background:#0b0d11; overflow:hidden; }
  .code .head { display:flex; align-items:center; gap:var(--s2); padding:var(--s2) var(--s3);
    border-bottom:1px solid var(--line); color:var(--text-3); font-size:var(--fs-xs); }
  .code pre { margin:0; padding:var(--s4); overflow-x:auto; color:var(--text-2);
    font:var(--fs-xs)/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .code .k { color:#8fb6ff; }
  .code .s { color:#9bd2a8; }

  .cta-band { border-top:1px solid var(--line); padding:var(--s8) 0; }
  .cta-band .inner { display:flex; align-items:center; gap:var(--s5); flex-wrap:wrap; }
  .cta-band h2 { font-size:var(--fs-h2); font-weight:600; }
  .cta-band p { color:var(--text-2); font-size:var(--fs-sm); margin-top:var(--s1); }
  .cta-band .actions { margin-left:auto; display:flex; gap:var(--s3); flex-wrap:wrap; }
</style>
</head>
<body>
<a class="skip" href="#main">\u8DF3\u5230\u4E3B\u8981\u5185\u5BB9</a>
<header class="nav">
  <div class="inner">
    <a class="brand" href="/"><img src="/icon.svg" alt="">PlaitCode</a>
    <nav class="nav-links" aria-label="\u4E3B\u5BFC\u822A">
      <a href="#product">\u4EA7\u54C1</a>
      <a href="#security">\u5B89\u5168</a>
      <a href="#compare">\u4E0E\u5176\u5B83\u5DE5\u5177</a>
      <a href="#start">\u4E0A\u624B</a>
    </nav>
    <div class="nav-actions">
      <a class="btn btn-ghost" href="${o}">GitHub</a>
      <a class="btn btn-primary" href="/console">\u6253\u5F00\u63A7\u5236\u53F0</a>
    </div>
  </div>
</header>

<main id="main">
  <div class="hero">
    <div class="wrap">
      <div class="hero-grid">
        <div>
          <span class="badge">${R("activity","icon icon-sm")} 0.15 \xB7 \u4E2D\u7EE7\u81EA\u5E26\u7F51\u7AD9\u4E0E\u63A7\u5236\u53F0</span>
          <h1>\u624B\u673A\u53D1\u4E00\u53E5\u8BDD\uFF0C<br>\u6307\u5B9A\u7684\u90A3\u53F0\u7535\u8111\u5F00\u59CB\u5199\u3002</h1>
          <p class="lede">PlaitCode \u628A\u9700\u6C42\u3001\u8FFD\u95EE\u3001\u6388\u6743\u3001\u7ED3\u679C\u653E\u8FDB\u540C\u4E00\u6761\u9891\u9053\u3002\u516C\u53F8\u7535\u8111\u3001\u5BB6\u91CC Mac\u3001\u624B\u673A\u5404\u81EA\u5728\u7EBF\uFF0C\u8C01\u6267\u884C\u7531\u4F60\u70B9\u3002</p>
          <div class="actions">
            <a class="btn btn-primary btn-lg" href="${r}">\u5728 VS Code \u5B89\u88C5</a>
            <a class="btn btn-lg" href="/console">\u6253\u5F00\u63A7\u5236\u53F0</a>
            <a class="btn btn-ghost btn-lg" href="/m">\u624B\u673A\u7AEF \u2192</a>
          </div>
          <div class="meta">
            <span>${R("key","icon icon-sm")} \u7AEF\u5230\u7AEF\u52A0\u5BC6</span>
            <span>${R("server","icon icon-sm")} \u81EA\u6258\u7BA1\u514D\u8D39</span>
            <span>${R("users","icon icon-sm")} \u5355\u4EBA\u4E5F\u80FD\u7528</span>
          </div>
        </div>

        <div class="window" role="img" aria-label="\u56E2\u961F\u7FA4\u754C\u9762\u793A\u610F\uFF1A\u4E09\u53F0\u8BBE\u5907\u5728\u7EBF\uFF0C\u9700\u6C42\u6307\u6D3E\u7ED9\u516C\u53F8\u7535\u8111\u6267\u884C">
          <div class="window-bar"><span class="dots"><i></i><i></i><i></i></span>\u56E2\u961F\u7FA4 \xB7 3 \u53F0\u8BBE\u5907\u5728\u7EBF</div>
          <div class="window-body">
            <div class="msg mine">
              <span class="who">\u4F60 \xB7 \u624B\u673A</span>
              <span class="bubble">\u628A\u767B\u5F55\u9875\u7684\u9519\u8BEF\u63D0\u793A\u6539\u6210\u4E2D\u6587\uFF0C\u5E76\u8865\u4E00\u6761\u6D4B\u8BD5</span>
            </div>
            <div class="msg">
              <span class="who">\u516C\u53F8\u7535\u8111 <span class="tag tag-ok"><span class="dot"></span>\u6267\u884C\u4E2D</span></span>
              <span class="bubble">\u5DF2\u5F00\u59CB\uFF1A\u5148\u8BFB src/auth/login.ts\uFF0C\u518D\u6539\u6587\u6848\u4E0E\u65AD\u8A00\u3002</span>
            </div>
            <div class="msg">
              <span class="who">\u5BB6\u91CC Mac \xB7 \u5F85\u63A5</span>
              <span class="bubble">\u8FD9\u6761\u9700\u6C42\u6307\u6D3E\u7ED9\u4E86\u516C\u53F8\u7535\u8111\uFF0C\u672C\u673A\u672A\u6267\u884C\u3002</span>
            </div>
            <div class="mock-assign">
              <span>\u7531\u8C01\u6267\u884C</span>
              <span class="mock-chip">\u6240\u6709\u4EBA</span>
              <span class="mock-chip on">\u516C\u53F8\u7535\u8111</span>
              <span class="mock-chip">\u5BB6\u91CC Mac</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <section class="section" id="start">
    <div class="wrap">
      <div class="section-head">
        <div class="eyebrow">\u4E09\u6B65</div>
        <h2>\u88C5\u597D\u5230\u624B\u673A\u80FD\u6307\u6325\uFF0C\u53EA\u505A\u4E09\u4EF6\u4E8B</h2>
        <p class="lede">\u4E0D\u9700\u8981\u516C\u7F51 IP\uFF0C\u4E0D\u9700\u8981\u8DEF\u7531\u5668\u7AEF\u53E3\u6620\u5C04\uFF0C\u4E5F\u4E0D\u9700\u8981\u628A\u4EE3\u7801\u4F20\u5230\u4EFB\u4F55\u670D\u52A1\u5668\u3002</p>
      </div>
      <div class="steps">
        ${d.map(([p,f],k)=>`<div class="step"><div class="n">0${k+1}</div><h3>${p}</h3><p>${f}</p></div>`).join("")}
      </div>
    </div>
  </section>

  <section class="section" id="product">
    <div class="wrap">
      <div class="section-head">
        <div class="eyebrow">\u4EA7\u54C1</div>
        <h2>\u5B83\u89E3\u51B3\u7684\u662F\u300C\u8C01\u6765\u505A\u300D</h2>
        <p class="lede">\u4E0D\u662F\u53C8\u4E00\u4E2A\u804A\u5929\u7A97\u53E3\uFF0C\u800C\u662F\u628A\u300C\u9700\u6C42 \u2192 \u6267\u884C \u2192 \u56DE\u6267\u300D\u9489\u5728\u4E00\u6761\u6709\u4E3B\u8BED\u7684\u9891\u9053\u4E0A\u3002</p>
      </div>
      <div class="grid-3">
        ${i.map(([p,f,k])=>`<div class="card"><h3>${R(p)}${f}</h3><p>${k}</p></div>`).join("")}
      </div>
    </div>
  </section>

  <section class="section" id="security">
    <div class="wrap">
      <div class="grid-2">
        <div>
          <div class="eyebrow">\u5B89\u5168</div>
          <h2>\u670D\u52A1\u5668\u770B\u5230\u7684\u53EA\u6709\u5BC6\u6587</h2>
          <p class="lede" style="color:var(--text-2);margin-top:var(--s2)">\u9891\u9053\u5BC6\u94A5\u5728\u8BBE\u5907\u4E4B\u95F4\u534F\u5546\uFF0C\u53EA\u653E\u5728\u6D4F\u89C8\u5668 fragment \u4E0E\u672C\u5730\u5B89\u5168\u5B58\u50A8\u91CC\u3002\u4E2D\u7EE7\u8D1F\u8D23\u6392\u961F\u548C\u8F6C\u53D1\uFF0C\u89E3\u4E0D\u5F00\u4EFB\u4F55\u4E00\u6761\u6D88\u606F\u3002</p>
          <div style="display:grid;gap:var(--s4);margin-top:var(--s5)">
            <div class="quote"><b>\u5BC6\u94A5\u4E0D\u8FDB\u670D\u52A1\u5668\u3002</b>URL fragment \u4E0D\u4F1A\u51FA\u73B0\u5728\u8BF7\u6C42\u884C\uFF0C\u4E5F\u4E0D\u4F1A\u8FDB nginx \u65E5\u5FD7\u3002</div>
            <div class="quote"><b>\u4EE4\u724C\u53EA\u5B58\u54C8\u5E0C\u3002</b>\u8BBE\u5907\u4EE4\u724C\u53EF\u4EE5\u968F\u65F6\u540A\u9500\uFF0C\u540A\u9500\u7ACB\u5373\u751F\u6548\u3002</div>
            <div class="quote"><b>\u5BA1\u8BA1\u53EA\u6709\u5143\u6570\u636E\u3002</b>\u8C01\u3001\u54EA\u53F0\u8BBE\u5907\u3001\u4EC0\u4E48\u65F6\u95F4\u3001\u591A\u5927\u5BC6\u6587 \u2014\u2014 \u6CA1\u6709\u6B63\u6587\u3002</div>
          </div>
        </div>
        <div class="code">
          <div class="head">${R("server","icon icon-sm")} \u4E2D\u7EE7\u80FD\u62FF\u5230\u7684\u5168\u90E8\u5185\u5BB9</div>
          <pre>{
  <span class="k">"seq"</span>: 42,
  <span class="k">"id"</span>: <span class="s">"3f9c\u2026"</span>,
  <span class="k">"from"</span>: <span class="s">"dev_office"</span>,
  <span class="k">"envelope"</span>: {
    <span class="k">"iv"</span>: <span class="s">"9Qm2\u2026"</span>,
    <span class="k">"ct"</span>: <span class="s">"Zk8v\u2026"</span>
  },
  <span class="k">"at"</span>: 1763000000000
}</pre>
        </div>
      </div>
    </div>
  </section>

  <section class="section" id="compare">
    <div class="wrap">
      <div class="section-head">
        <div class="eyebrow">\u5B9A\u4F4D</div>
        <h2>\u548C\u73B0\u6709\u534F\u4F5C\u5DE5\u5177\u7684\u5206\u5DE5</h2>
        <p class="lede">\u5B83\u4E0D\u66FF\u4EE3\u4E0B\u9762\u4EFB\u4F55\u4E00\u4EF6\uFF0C\u8865\u7684\u662F\u5B83\u4EEC\u90FD\u4E0D\u505A\u7684\u90A3\u4E00\u6BB5\u3002</p>
      </div>
      <table>
        <thead><tr><th>\u5DE5\u5177</th><th>\u64C5\u957F</th><th>\u5DEE\u7684\u90A3\u4E00\u6BB5</th></tr></thead>
        <tbody>
          ${g.map(([p,f,k],A)=>`<tr><td style="font-weight:${A===g.length-1?600:400}">${p}</td><td>${f}</td><td style="color:var(--text-2)">${k}</td></tr>`).join("")}
        </tbody>
      </table>
      ${e.consoleEnabled?"":`<div class="banner">${R("shield","icon icon-sm")}<span>\u8FD9\u53F0\u670D\u52A1\u5668\u8FD8\u6CA1\u914D\u98DE\u4E66\u767B\u5F55\uFF08<code>PLAITCODE_AUTH_APP_ID</code> / <code>SECRET</code> / <code>REDIRECT_URI</code>\uFF09\uFF0C\u63A7\u5236\u53F0\u6682\u65F6\u6253\u4E0D\u5F00\uFF1B\u8BBE\u5907\u4E0E\u901A\u9053\u4ECD\u53EF\u7528\u7BA1\u7406\u63A5\u53E3\u67E5\u770B\u3002</span></div>`}
    </div>
  </section>

  <div class="cta-band">
    <div class="wrap inner">
      <div>
        <h2>\u73B0\u5728\u5C31\u53EF\u4EE5\u5F00\u59CB</h2>
        <p>\u670D\u52A1\u7AEF ${t} \xB7 \u81EA\u6258\u7BA1\u5355\u6587\u4EF6\uFF0C\u4E94\u5206\u949F\u90E8\u7F72</p>
      </div>
      <div class="actions">
        <a class="btn btn-primary btn-lg" href="${r}">\u5B89\u88C5\u6269\u5C55</a>
        <a class="btn btn-lg" href="/console">\u6253\u5F00\u63A7\u5236\u53F0</a>
        <a class="btn btn-ghost btn-lg" href="/m">\u624B\u673A\u7AEF</a>
      </div>
    </div>
  </div>
</main>

<footer class="site">
  <div class="wrap">
    <div class="foot-cols">
      <div>
        <h4>\u4EA7\u54C1</h4>
        <ul>
          <li><a href="/">\u9996\u9875</a></li>
          <li><a href="/console">\u63A7\u5236\u53F0</a></li>
          <li><a href="/m">\u624B\u673A\u7AEF</a></li>
        </ul>
      </div>
      <div>
        <h4>\u8D44\u6E90</h4>
        <ul>
          <li><a href="${o}">GitHub</a></li>
          <li><a href="${o}/tree/main/docs">\u6587\u6863</a></li>
          <li><a href="/health">\u8FD0\u884C\u72B6\u6001</a></li>
        </ul>
      </div>
      <div>
        <h4>\u90E8\u7F72</h4>
        <ul>
          <li><a href="${o}/blob/main/deploy/relay/README.md">\u81EA\u6258\u7BA1\u8BF4\u660E</a></li>
          <li><a href="${o}/blob/main/docs/ENTERPRISE.md">\u4F01\u4E1A\u80FD\u529B</a></li>
          <li><a href="${o}/blob/main/docs/WEBSITE.md">\u7F51\u7AD9\u4E0E\u63A7\u5236\u53F0</a></li>
        </ul>
      </div>
      <div>
        <h4>\u5165\u53E3</h4>
        <ul>
          <li><a href="${r}">Marketplace</a></li>
          <li><a href="/console">\u767B\u5F55</a></li>
          <li><a href="/m">\u626B\u7801\u8FDB\u5165</a></li>
        </ul>
      </div>
    </div>
    <div class="foot-bottom">
      <span>\xA9 2026 PlaitCode</span>
      <span>\u670D\u52A1\u7AEF ${t}</span>
      <span style="margin-left:auto">\u53EA\u8F6C\u53D1\u5BC6\u6587 \xB7 \u4E0D\u5B58\u4EE3\u7801</span>
    </div>
  </div>
</footer>
</body>
</html>`}function Te(e){let t=Z(e.relayHost),r=e.sessionAuth?"true":"false";return`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0f1115">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: 'self'; connect-src 'self'; manifest-src 'self'">
<title>PlaitCode \u63A7\u5236\u53F0</title>
<style>${Ee}
  .shell { display:grid; grid-template-columns:216px minmax(0,1fr); min-height:100vh; }
  .side { border-right:1px solid var(--line); padding:var(--s4) var(--s3); display:flex; flex-direction:column; gap:var(--s4); }
  .side-head { display:flex; align-items:center; gap:var(--s2); padding:0 var(--s2) var(--s2); }
  .side-head img { width:24px; height:24px; border-radius:var(--r-sm); }
  .side-head b { font-size:var(--fs-sm); font-weight:600; display:block; }
  .side-head span { color:var(--text-3); font-size:var(--fs-xs); }
  .side nav { display:grid; gap:2px; }
  .side nav a { display:flex; align-items:center; gap:var(--s2); height:32px; padding:0 var(--s2);
    border-radius:var(--r-md); color:var(--text-2); font-size:var(--fs-sm); }
  .side nav a:hover { background:var(--surface-2); color:var(--text); text-decoration:none; }
  .side nav a[aria-current="page"] { background:var(--surface-2); color:var(--text); font-weight:600; }
  .side nav a[aria-current="page"] .icon { color:var(--accent); }
  .side-foot { margin-top:auto; padding:var(--s3) var(--s2) 0; border-top:1px solid var(--line);
    display:grid; gap:var(--s1); color:var(--text-3); font-size:var(--fs-xs); }
  .side-foot a { color:var(--text-2); }
  .main { min-width:0; }
  .main-head { position:sticky; top:0; z-index:5; height:var(--nav-h); display:flex; align-items:center;
    gap:var(--s3); padding:0 var(--s6); border-bottom:1px solid var(--line);
    background:rgba(15,17,21,.86); backdrop-filter:blur(12px); }
  .main-head .who { margin-left:auto; display:flex; align-items:center; gap:var(--s3);
    color:var(--text-2); font-size:var(--fs-sm); }
  .main-head .who a { color:var(--text-2); }
  .main-body { padding:var(--s6); max-width:1040px; }
  .page-head { display:flex; align-items:flex-start; gap:var(--s4); flex-wrap:wrap; margin-bottom:var(--s6); }
  .page-head h1 { font-size:var(--fs-h2); font-weight:600; letter-spacing:-.2px; }
  .page-head p { margin-top:var(--s1); color:var(--text-2); font-size:var(--fs-sm); max-width:60ch; }
  .page-head .actions { margin-left:auto; display:flex; gap:var(--s2); }

  .stats { display:grid; gap:var(--s3); grid-template-columns:repeat(4, minmax(0,1fr)); margin-bottom:var(--s6); }
  .stat { border:1px solid var(--line); border-radius:var(--r-lg); background:var(--surface); padding:var(--s4); }
  .stat b { display:block; font-size:24px; line-height:1.2; font-weight:600; font-variant-numeric:tabular-nums; }
  .stat span { color:var(--text-2); font-size:var(--fs-xs); }
  @media (max-width:1000px) { .stats { grid-template-columns:repeat(2, minmax(0,1fr)); } }

  .panel { border:1px solid var(--line); border-radius:var(--r-lg); background:var(--surface); overflow:hidden; }
  .panel + .panel { margin-top:var(--s5); }
  .panel-head { display:flex; align-items:center; gap:var(--s3); padding:var(--s3) var(--s4);
    border-bottom:1px solid var(--line); }
  .panel-head h2 { font-size:var(--fs-h3); font-weight:600; }
  .panel-head .count { color:var(--text-3); font-size:var(--fs-xs); }
  .panel-head .actions { margin-left:auto; display:flex; gap:var(--s2); }
  .cell-main { display:flex; align-items:center; gap:var(--s2); }
  .cell-main b { font-weight:600; }
  .cell-sub { color:var(--text-3); font-size:var(--fs-xs); margin-top:2px; }
  .cell-right { text-align:right; white-space:nowrap; }
  .err { padding:var(--s5) var(--s4); color:var(--bad); font-size:var(--fs-sm); }

  @media (max-width:840px) {
    .shell { grid-template-columns:1fr; }
    .side { border-right:0; border-bottom:1px solid var(--line); padding:var(--s3); }
    .side nav { grid-auto-flow:column; grid-auto-columns:max-content; overflow-x:auto; }
    .side-foot { display:none; }
    .main-head { padding:0 var(--s4); }
    .main-body { padding:var(--s4); }
  }
</style>
</head>
<body>
<a class="skip" href="#main">\u8DF3\u5230\u4E3B\u8981\u5185\u5BB9</a>
<div class="shell">
  <aside class="side">
    <div class="side-head">
      <img src="/icon.svg" alt="">
      <div><b>PlaitCode \u63A7\u5236\u53F0</b><span>${t}</span></div>
    </div>
    <nav aria-label="\u63A7\u5236\u53F0\u5BFC\u822A" id="tabs">
      <a href="#overview" data-tab="overview" aria-current="page">${R("activity","icon icon-sm")}\u6982\u89C8</a>
      <a href="#devices" data-tab="devices">${R("terminal","icon icon-sm")}\u8BBE\u5907</a>
      <a href="#channels" data-tab="channels">${R("board","icon icon-sm")}\u901A\u9053</a>
      <a href="#audit" data-tab="audit">${R("shield","icon icon-sm")}\u5BA1\u8BA1</a>
    </nav>
    <div class="side-foot">
      <a href="/">\u8FD4\u56DE\u9996\u9875</a>
      <a href="/m">\u624B\u673A\u7AEF</a>
      <a href="#" id="logout">\u9000\u51FA\u767B\u5F55</a>
    </div>
  </aside>

  <div class="main">
    <div class="main-head">
      <span class="tag" id="conn"><span class="dot"></span>\u8BFB\u53D6\u4E2D</span>
      <div class="who"><span id="who">\u672A\u767B\u5F55</span></div>
    </div>
    <div class="main-body" id="main">
      <div id="notice"></div>
      <div id="view">
        <div class="skeleton" style="width:180px;margin-bottom:16px"></div>
        <div class="skeleton" style="width:60%"></div>
      </div>
    </div>
  </div>
</div>

<script>
(function () {
  var sessionAuth = ${r};
  var data = null;
  var tab = 'overview';
  var view = document.getElementById('view');
  var notice = document.getElementById('notice');
  var who = document.getElementById('who');
  var conn = document.getElementById('conn');

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function svg(name) {
    var paths = {
      terminal: 'M4 5h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm2 4 2 2-2 2m4-2h4',
      shield: 'M10 3 4.5 5v4.5c0 3.2 2.2 6.1 5.5 7 3.3-.9 5.5-3.8 5.5-7V5L10 3Z',
      board: 'M3.5 4h4.2v12H3.5zM8.8 4h4.2v8H8.8zM14.1 4h2.4v10h-2.4z',
      activity: 'M3 11h3l2-5 3.5 9 2-4h3.5'
    };
    var ns = 'http://www.w3.org/2000/svg';
    var node = document.createElementNS(ns, 'svg');
    node.setAttribute('viewBox', '0 0 20 20');
    node.setAttribute('class', 'icon');
    node.setAttribute('aria-hidden', 'true');
    node.setAttribute('fill', 'none');
    node.setAttribute('stroke', 'currentColor');
    node.setAttribute('stroke-width', '1.5');
    node.setAttribute('stroke-linecap', 'round');
    node.setAttribute('stroke-linejoin', 'round');
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', paths[name] || '');
    node.appendChild(path);
    return node;
  }

  function when(ts) {
    if (!ts) return '\u2014';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '\u2014';
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function relative(ts) {
    if (!ts) return '\u4ECE\u672A';
    var diff = Date.now() - ts;
    if (diff < 60000) return '\u521A\u521A';
    if (diff < 3600000) return Math.round(diff / 60000) + ' \u5206\u949F\u524D';
    if (diff < 86400000) return Math.round(diff / 3600000) + ' \u5C0F\u65F6\u524D';
    return Math.round(diff / 86400000) + ' \u5929\u524D';
  }

  function banner(text) {
    notice.textContent = '';
    if (!text) return;
    var box = el('div', 'banner');
    box.appendChild(el('span', null, text));
    notice.appendChild(box);
  }

  function fail(message) {
    view.textContent = '';
    view.appendChild(el('div', 'err', message));
  }

  function emptyState(iconName, title, body) {
    var box = el('div', 'empty');
    box.appendChild(svg(iconName));
    box.appendChild(el('b', null, title));
    box.appendChild(el('p', null, body));
    return box;
  }

  function pageHead(title, desc, actions) {
    var node = el('div', 'page-head');
    var left = el('div');
    left.appendChild(el('h1', null, title));
    left.appendChild(el('p', null, desc));
    node.appendChild(left);
    if (actions && actions.length) {
      var right = el('div', 'actions');
      actions.forEach(function (button) { right.appendChild(button); });
      node.appendChild(right);
    }
    return node;
  }

  function stat(value, label) {
    var node = el('div', 'stat');
    node.appendChild(el('b', null, value));
    node.appendChild(el('span', null, label));
    return node;
  }

  function panel(title, count) {
    var node = el('div', 'panel');
    var head = el('div', 'panel-head');
    head.appendChild(el('h2', null, title));
    if (count !== undefined && count !== null) head.appendChild(el('span', 'count', String(count)));
    node.appendChild(head);
    var body = el('div');
    node.appendChild(body);
    return { node: node, body: body };
  }

  function table(headers) {
    var t = el('table');
    var thead = el('thead');
    var tr = el('tr');
    headers.forEach(function (header) {
      var th = el('th', header.num ? 'num' : null, header.label);
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    t.appendChild(thead);
    var tbody = el('tbody');
    t.appendChild(tbody);
    return { node: t, body: tbody };
  }

  function row(children) {
    var tr = el('tr');
    children.forEach(function (child) {
      var td = el('td', child && child.className === 'cell-right' ? 'num' : null);
      if (child) td.appendChild(child);
      tr.appendChild(td);
    });
    return tr;
  }

  function renderOverview() {
    view.appendChild(pageHead('\u6982\u89C8', '\u8FD9\u6761\u9891\u9053\u4E0A\u8C01\u5728\u7EBF\u3001\u8BBE\u5907\u591F\u4E0D\u591F\u7528\u3001\u6700\u8FD1\u53D1\u751F\u4E86\u4EC0\u4E48\u3002'));

    var stats = el('div', 'stats');
    stats.appendChild(stat(data.counts.devices, '\u8BBE\u5907\uFF08\u672A\u540A\u9500\uFF09'));
    stats.appendChild(stat(data.counts.online, '\u5F53\u524D\u5728\u7EBF'));
    stats.appendChild(stat(data.counts.channels, '\u901A\u9053'));
    stats.appendChild(stat(data.counts.members, '\u6210\u5458'));
    view.appendChild(stats);

    var recent = panel('\u6700\u8FD1\u6D3B\u52A8', data.audit.length + ' \u6761');
    if (!data.audit.length) {
      recent.body.appendChild(emptyState('shield', '\u8FD8\u6CA1\u6709\u8BB0\u5F55',
        '\u8BBE\u5907\u8FDE\u4E0A\u4E2D\u7EE7\u540E\uFF0C\u8FD9\u91CC\u4F1A\u51FA\u73B0\u53D1\u5E03\u3001\u5728\u7EBF\u3001\u88AB\u62D2\u7EDD\u7B49\u4E8B\u4EF6\uFF1B\u5BA1\u8BA1\u53EA\u8BB0\u5143\u6570\u636E\uFF0C\u4E0D\u542B\u6B63\u6587\u3002'));
    } else {
      var t = table([{ label: '\u65F6\u95F4' }, { label: '\u4E8B\u4EF6' }, { label: '\u9891\u9053' }, { label: '\u8BE6\u60C5' }]);
      data.audit.slice(0, 12).forEach(function (item) {
        var name = el('div', 'cell-main');
        name.appendChild(el('b', null, String(item.event || '')));
        t.body.appendChild(row([
          el('span', 'cell-sub', when(item.ts)),
          name,
          el('span', 'mono', item.channel ? String(item.channel).slice(0, 10) : '\u2014'),
          el('span', 'cell-sub', item.detail ? String(item.detail) : '\u2014')
        ]));
      });
      recent.body.appendChild(t.node);
    }
    view.appendChild(recent.node);
  }

  function renderDevices() {
    var invite = el('button', 'btn', '\u600E\u4E48\u63A5\u5165\u65B0\u8BBE\u5907');
    invite.addEventListener('click', function () {
      alert('\u5728\u5DF2\u6388\u6743\u7684\u7535\u8111\u4E0A\u6267\u884C\uFF1A\\n\\nPlaitCode: \u7ED9\u53E6\u4E00\u53F0\u8BBE\u5907\u53D1\u914D\u5BF9\u4FE1\u606F\uFF08\u542B\u8BBE\u5907\u4EE4\u724C\uFF09\\n\\n\u628A\u590D\u5236\u51FA\u6765\u7684\u90A3\u4E00\u884C\u7C98\u5230\u65B0\u7535\u8111\u7684\u300C\u52A0\u5165\u8DE8\u7F51\u9891\u9053\u300D\u5373\u53EF\u3002\u63A7\u5236\u53F0\u4E0D\u53D1\u4EE4\u724C \u2014\u2014 \u9891\u9053\u5BC6\u94A5\u53EA\u5B58\u5728\u4F60\u7684\u8BBE\u5907\u4E0A\u3002');
    });
    view.appendChild(pageHead('\u8BBE\u5907', '\u6BCF\u53F0\u7535\u8111\u4E00\u6761\u8BB0\u5F55\u3002\u6362\u673A\u5668\u65F6\u5148\u5728\u8FD9\u91CC\u540A\u9500\u65E7\u7684\uFF0C\u518D\u8BA9\u65B0\u673A\u5668\u63A5\u5165\u3002', [invite]));

    var list = panel('\u8BBE\u5907', data.devices.length);
    if (!data.devices.length) {
      list.body.appendChild(emptyState('terminal', '\u8FD8\u6CA1\u6709\u8BBE\u5907',
        '\u5728 VS Code \u91CC\u6267\u884C\u300CPlaitCode: \u65B0\u5EFA\u8DE8\u7F51\u9891\u9053\u300D\uFF0C\u8FD9\u53F0\u7535\u8111\u4F1A\u81EA\u52A8\u767B\u8BB0\u8FDB\u6765\u3002'));
    } else {
      var t = table([{ label: '\u8BBE\u5907' }, { label: '\u5E73\u53F0' }, { label: '\u6210\u5458' }, { label: '\u6700\u8FD1\u5728\u7EBF' }, { label: '\u72B6\u6001' }, { label: '\u64CD\u4F5C', num: true }]);
      data.devices.forEach(function (device) {
        var name = el('div', 'cell-main');
        var stack = el('div');
        stack.appendChild(el('b', null, device.name));
        stack.appendChild(el('div', 'cell-sub', (device.grants || []).map(function (g) {
          return String(g.channelId).slice(0, 8) + ' \xB7 ' + g.role;
        }).join('  ')));
        name.appendChild(stack);

        var status = el('span', 'tag' + (device.revokedAt ? ' tag-bad' : (device.online ? ' tag-ok' : '')));
        status.appendChild(el('span', 'dot'));
        status.appendChild(el('span', null, device.revokedAt ? '\u5DF2\u540A\u9500' : (device.online ? '\u5728\u7EBF' : '\u79BB\u7EBF')));

        var actions = el('div', 'cell-right');
        if (!device.revokedAt) {
          var revoke = el('button', 'btn btn-danger', '\u540A\u9500');
          revoke.addEventListener('click', function () {
            if (!confirm('\u540A\u9500\u540E\u8FD9\u53F0\u8BBE\u5907\u7ACB\u523B\u5931\u53BB\u9891\u9053\u8BBF\u95EE\u3002\u786E\u5B9A\u8981\u540A\u9500\u300C' + device.name + '\u300D\u5417\uFF1F')) return;
            revoke.disabled = true;
            revoke.textContent = '\u540A\u9500\u4E2D\u2026';
            fetch('/v1/console/devices/revoke', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ deviceId: device.id })
            }).then(function (res) {
              if (res.status === 401) { location.href = '/v1/auth/feishu/start?next=console'; return; }
              return res.json().then(function (payload) {
                if (!payload.ok) {
                  revoke.disabled = false;
                  revoke.textContent = '\u540A\u9500';
                  alert(payload.error || '\u540A\u9500\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5');
                  return;
                }
                load();
              });
            }).catch(function () {
              revoke.disabled = false;
              revoke.textContent = '\u540A\u9500';
              alert('\u7F51\u7EDC\u9519\u8BEF\uFF0C\u8BF7\u91CD\u8BD5');
            });
          });
          actions.appendChild(revoke);
        } else {
          actions.appendChild(el('span', 'cell-sub', when(device.revokedAt)));
        }

        t.body.appendChild(row([
          name,
          el('span', 'cell-sub', device.platform || '\u672A\u77E5'),
          el('span', 'cell-sub', device.memberName || '\u2014'),
          el('span', 'cell-sub', relative(device.lastSeenAt)),
          status,
          actions
        ]));
      });
      list.body.appendChild(t.node);
    }
    view.appendChild(list.node);
  }

  function renderChannels() {
    view.appendChild(pageHead('\u901A\u9053', '\u4E00\u6761\u901A\u9053\u5BF9\u5E94\u4E00\u6761\u534F\u4F5C\u7EBF\u3002\u9891\u9053 ID \u7531\u5BC6\u94A5\u6D3E\u751F\uFF0C\u670D\u52A1\u7AEF\u53CD\u63A8\u4E0D\u51FA\u5BC6\u94A5\u3002'));

    var list = panel('\u901A\u9053', data.channels.length);
    if (!data.channels.length) {
      list.body.appendChild(emptyState('board', '\u8FD8\u6CA1\u6709\u901A\u9053',
        '\u5728 VS Code \u91CC\u6267\u884C\u300CPlaitCode: \u65B0\u5EFA\u8DE8\u7F51\u9891\u9053\u300D\u540E\uFF0C\u8FD9\u91CC\u4F1A\u51FA\u73B0\u7B2C\u4E00\u6761\u901A\u9053\u3002'));
    } else {
      var t = table([{ label: '\u9891\u9053 ID' }, { label: '\u5728\u7EBF / \u8BBE\u5907' }, { label: '\u6700\u8FD1\u6D88\u606F' }, { label: '\u8BBE\u5907' }]);
      data.channels.forEach(function (channel) {
        var id = el('div', 'cell-main');
        id.appendChild(el('b', 'mono', channel.channelId));
        t.body.appendChild(row([
          id,
          el('span', 'cell-sub', channel.online + ' / ' + channel.devices),
          el('span', 'cell-sub', when(channel.lastMessageAt)),
          el('span', 'cell-sub', (channel.deviceNames || []).join(' / ') || '\u2014')
        ]));
      });
      list.body.appendChild(t.node);
    }
    view.appendChild(list.node);
  }

  function renderAudit() {
    view.appendChild(pageHead('\u5BA1\u8BA1', '\u53EA\u8BB0\u5143\u6570\u636E\uFF1A\u8C01\u3001\u54EA\u53F0\u8BBE\u5907\u3001\u4EC0\u4E48\u65F6\u95F4\u3001\u591A\u5927\u5BC6\u6587\u3002\u6B63\u6587\u4ECE\u4E0D\u843D\u5E93\u3002'));

    var list = panel('\u6700\u8FD1\u4E8B\u4EF6', data.audit.length + ' \u6761');
    if (!data.audit.length) {
      list.body.appendChild(emptyState('shield', '\u8FD8\u6CA1\u6709\u5BA1\u8BA1\u8BB0\u5F55',
        '\u9700\u8981\u670D\u52A1\u7AEF\u914D\u7F6E PLAITCODE_AUDIT_PATH \u624D\u4F1A\u843D\u76D8\uFF1B\u6CA1\u914D\u65F6\u4E8B\u4EF6\u53EA\u5199\u5230 stdout \u4EA4\u7ED9 journald\u3002'));
    } else {
      var t = table([{ label: '\u65F6\u95F4' }, { label: '\u4E8B\u4EF6' }, { label: '\u8BBE\u5907' }, { label: '\u9891\u9053' }, { label: '\u8BE6\u60C5' }]);
      data.audit.forEach(function (item) {
        t.body.appendChild(row([
          el('span', 'cell-sub', when(item.ts)),
          el('b', null, String(item.event || '')),
          el('span', 'mono', item.device || '\u2014'),
          el('span', 'mono', item.channel ? String(item.channel).slice(0, 10) : '\u2014'),
          el('span', 'cell-sub', item.detail ? String(item.detail) : '\u2014')
        ]));
      });
      list.body.appendChild(t.node);
    }
    view.appendChild(list.node);
  }

  function render() {
    view.textContent = '';
    if (!data) return;
    who.textContent = data.member.name + (data.org ? ' \xB7 ' + data.org.name : '') + ' \xB7 ' + data.member.role;
    conn.textContent = '';
    conn.appendChild(el('span', 'dot'));
    conn.appendChild(el('span', null, data.counts.online > 0 ? data.counts.online + ' \u53F0\u5728\u7EBF' : '\u65E0\u8BBE\u5907\u5728\u7EBF'));
    conn.className = 'tag' + (data.counts.online > 0 ? ' tag-ok' : '');
    if (tab === 'overview') renderOverview();
    else if (tab === 'devices') renderDevices();
    else if (tab === 'channels') renderChannels();
    else renderAudit();
  }

  function load() {
    fetch('/v1/console/state', { credentials: 'same-origin' }).then(function (res) {
      if (res.status === 401) {
        if (sessionAuth) { location.href = '/v1/auth/feishu/start?next=console'; return; }
        conn.textContent = '\u672A\u542F\u7528\u767B\u5F55';
        fail('\u8FD9\u53F0\u670D\u52A1\u5668\u6CA1\u6709\u5F00\u542F\u98DE\u4E66\u767B\u5F55\uFF08PLAITCODE_AUTH_APP_ID / SECRET / REDIRECT_URI\uFF09\uFF0C\u63A7\u5236\u53F0\u4E0D\u53EF\u7528\u3002');
        return;
      }
      return res.json().then(function (payload) {
        if (!payload.ok) { fail(payload.error || '\u8BFB\u53D6\u5931\u8D25'); return; }
        data = payload;
        render();
      });
    }).catch(function () { fail('\u8BFB\u53D6\u5931\u8D25\uFF1A\u4E2D\u7EE7\u6CA1\u6709\u54CD\u5E94\uFF0C\u8BF7\u68C0\u67E5\u670D\u52A1\u662F\u5426\u5728\u8FD0\u884C\u3002'); });
  }

  function selectTab(name) {
    tab = name;
    Array.prototype.forEach.call(document.querySelectorAll('#tabs a'), function (link) {
      if (link.getAttribute('data-tab') === name) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('#tabs a'), function (link) {
    link.addEventListener('click', function (event) {
      event.preventDefault();
      selectTab(link.getAttribute('data-tab'));
      if (history.replaceState) history.replaceState(null, '', '#' + tab);
      render();
    });
  });

  document.getElementById('logout').addEventListener('click', function (event) {
    event.preventDefault();
    fetch('/v1/auth/logout', { method: 'POST', credentials: 'same-origin' }).then(function () {
      location.href = '/';
    });
  });

  var initial = (location.hash || '').replace('#', '');
  if (initial && document.querySelector('#tabs a[data-tab="' + initial + '"]')) selectTab(initial);

  if (!sessionAuth) banner('\u670D\u52A1\u7AEF\u672A\u914D\u7F6E\u98DE\u4E66\u767B\u5F55\uFF0C\u63A7\u5236\u53F0\u6570\u636E\u63A5\u53E3\u4F1A\u62D2\u7EDD\u8BF7\u6C42\u3002\u914D\u7F6E PLAITCODE_AUTH_APP_ID / SECRET / REDIRECT_URI \u540E\u91CD\u542F\u4E2D\u7EE7\u5373\u53EF\u3002');
  load();
})();
</script>
</body>
</html>`}var ce=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="PlaitCode">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4c9aff"/>
      <stop offset="1" stop-color="#7c5cff"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="#0f1115"/>
  <path d="M150 372V140h96c52 0 88 32 88 80s-36 80-88 80h-44v72zm52-116h40c24 0 40-14 40-36s-16-36-40-36h-40z"
        fill="url(#g)"/>
  <circle cx="352" cy="352" r="26" fill="#4c9aff"/>
</svg>`;function Pe(){return JSON.stringify({name:"PlaitCode \xB7 \u56E2\u961F\u7FA4",short_name:"PlaitCode",description:"\u5728\u624B\u673A\u4E0A\u6307\u6325\u7535\u8111\u4E0A\u7684\u7F16\u7801 agent\uFF1A\u63D0\u9700\u6C42\u3001\u770B\u8FDB\u5EA6\u3001\u6279\u51C6\u64CD\u4F5C\u3002",start_url:"/m",scope:"/",display:"standalone",orientation:"portrait",background_color:"#0f1115",theme_color:"#0f1115",lang:"zh-CN",icons:[{src:"/icon.svg",sizes:"any",type:"image/svg+xml",purpose:"any"},{src:"/icon.svg",sizes:"any",type:"image/svg+xml",purpose:"maskable"}]},null,2)}var pe=`/* PlaitCode PWA service worker */
self.addEventListener('install', function (event) { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  // \u63A5\u53E3\u4E00\u5F8B\u76F4\u8FDE\uFF1A\u7F13\u5B58\u4F1A\u8BA9\u8F6E\u8BE2\u770B\u8D77\u6765\u6B63\u5E38\u4F46\u62FF\u4E0D\u5230\u65B0\u6D88\u606F
  if (url.pathname.indexOf('/v1/') === 0) return;
  if (url.pathname === '/sw.js' || url.pathname === '/manifest.webmanifest') return;
  event.respondWith(
    fetch(event.request).catch(function () {
      if (event.request.mode === 'navigate') {
        return new Response(
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
          + '<body style="background:#0f1115;color:#e5e7eb;font:16px/1.6 system-ui;padding:40px 20px;text-align:center">'
          + '<h1 style="font-size:18px">\u5F53\u524D\u6CA1\u6709\u7F51\u7EDC</h1>'
          + '<p style="color:#9aa3b2">\u8FDE\u4E0A\u7F51\u7EDC\u540E\u5237\u65B0\u9875\u9762\u5373\u53EF\u7EE7\u7EED\u3002</p></body>',
          { headers: { 'content-type': 'text/html; charset=utf-8' } },
        );
      }
      return new Response('', { status: 504 });
    }),
  );
});
`;var _t=10*6e4,Ot=720*6e4;var Mt=5*6e4;function Q(e){let t={};for(let r of(e??"").split(";")){let o=r.indexOf("=");if(o<=0)continue;let d=r.slice(0,o).trim();d&&(t[d]=decodeURIComponent(r.slice(o+1).trim()))}return t}var j=require("node:crypto"),B=require("node:fs/promises"),Oe=require("node:path"),ue=1,mt=100,gt=0,Dt=1440*6e4;function Me(){return{version:ue,orgs:[],members:[],devices:[]}}function fe(e){return`${e}_${(0,j.randomBytes)(9).toString("base64url")}`}function ht(){return`pct_${(0,j.randomBytes)(24).toString("base64url")}`}function $e(e){return(0,j.createHash)("sha256").update(e,"utf8").digest("hex")}function _e(e,t){let r=Buffer.from(e,"utf8"),o=Buffer.from(t,"utf8");return r.length===o.length&&(0,j.timingSafeEqual)(r,o)}var vt={viewer:["poll","presence"],member:["publish","poll","presence"],admin:["publish","poll","presence","manage"],owner:["publish","poll","presence","manage"]};function ee(e,t){return(vt[e]??[]).includes(t)}function De(e){return e==="owner"||e==="admin"||e==="member"||e==="viewer"}function Re(e,t){let r={id:fe("org"),name:t.trim().slice(0,80)||"org",createdAt:Date.now()};return e.orgs.push(r),r}function me(e,t){if(!e.orgs.some(d=>d.id===t.orgId))return;let r=De(t.role)?t.role:"member",o={id:fe("mem"),orgId:t.orgId,name:t.name.trim().slice(0,80)||"member",role:r,createdAt:Date.now()};return t.email?.trim()&&(o.email=t.email.trim()),t.openId?.trim()&&(o.openId=t.openId.trim()),t.unionId?.trim()&&(o.unionId=t.unionId.trim()),e.members.push(o),o}function He(e,t){let r=t.email?.trim().toLowerCase();if(r){let o=e.members.find(d=>d.id&&d.email?.trim().toLowerCase()===r);if(o)return o}if(t.openId){let o=e.members.find(d=>d.id&&d.openId===t.openId);if(o)return o}if(t.unionId)return e.members.find(o=>o.id&&o.unionId===t.unionId)}function ge(e,t){let r=e.members.find(p=>p.id===t.memberId);if(!r)return;let o=ht(),d=t.channels.filter(p=>typeof p.channelId=="string"&&p.channelId.trim().length>0).slice(0,mt).map(p=>({channelId:p.channelId.trim().slice(0,64),role:De(p.role)?p.role:r.role})),i=t.ttlMs===void 0?gt:t.ttlMs,g={id:fe("dev"),memberId:r.id,name:t.name.trim().slice(0,80)||"device",platform:(t.platform??"unknown").slice(0,20),tokenHash:$e(o),grants:d,createdAt:Date.now(),...i>0?{expiresAt:Date.now()+i}:{}};return e.devices.push(g),{device:g,token:o}}function he(e,t){let r=e.devices.find(o=>o.id===t);return!r||r.revokedAt?!1:(r.revokedAt=Date.now(),!0)}function te(e,t,r=Date.now()){if(!t.startsWith("pct_"))return;let o=$e(t),d=e.devices.find(i=>_e(i.tokenHash,o));return d||e.devices.find(i=>i.previousTokenHash&&i.previousValidUntil!==void 0&&r<i.previousValidUntil&&_e(i.previousTokenHash,o))}function Le(e,t,r,o,d=Date.now()){let i=te(e,t,d);if(!i)return{ok:!1,reason:"\u8BBE\u5907\u4EE4\u724C\u65E0\u6548"};if(i.revokedAt)return{ok:!1,device:i,reason:"\u8BBE\u5907\u5DF2\u88AB\u540A\u9500"};if(i.expiresAt!==void 0&&d>i.expiresAt)return{ok:!1,device:i,reason:"\u8BBE\u5907\u4EE4\u724C\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u8BB0\u8BBE\u5907"};let g=e.members.find(f=>f.id===i.memberId);if(!g)return{ok:!1,device:i,reason:"\u8BBE\u5907\u6240\u5C5E\u6210\u5458\u5DF2\u4E0D\u5B58\u5728"};let p=i.grants.find(f=>f.channelId===r);return p?ee(p.role,o)?(i.lastSeenAt=Date.now(),{ok:!0,device:i,member:g}):{ok:!1,device:i,member:g,reason:`\u89D2\u8272 ${p.role} \u4E0D\u80FD\u6267\u884C ${o}`}:{ok:!1,device:i,member:g,reason:"\u8FD9\u53F0\u8BBE\u5907\u6CA1\u6709\u8BE5\u9891\u9053\u7684\u6388\u6743"}}function ze(e,t,r,o){let d=e.members.find(k=>k.id===t);if(!d)return{ok:!1,reason:"\u6210\u5458\u4E0D\u5B58\u5728"};let i=e.devices.filter(k=>!k.revokedAt),g=i.filter(k=>k.memberId===t).flatMap(k=>k.grants).find(k=>k.channelId===r),p=g?.role??d.role;return(g?!0:i.some(k=>k.grants.some(A=>A.channelId===r)&&e.members.find(A=>A.id===k.memberId)?.orgId===d.orgId))?ee(p,o)?{ok:!0,member:d}:{ok:!1,member:d,reason:`\u89D2\u8272 ${p} \u4E0D\u80FD\u6267\u884C ${o}`}:{ok:!1,member:d,reason:"\u8FD9\u4E2A\u9891\u9053\u4E0D\u5C5E\u4E8E\u4F60\u6240\u5728\u7684\u7EC4\u7EC7"}}async function Ne(e,t){await(0,B.mkdir)((0,Oe.dirname)(e),{recursive:!0}).catch(()=>{});let r=`${e}.tmp`;await(0,B.writeFile)(r,`${JSON.stringify(t,null,2)}
`,"utf8"),await(0,B.rename)(r,e)}async function Be(e){try{let t=await(0,B.readFile)(e,"utf8"),r=JSON.parse(t);return r.version!==ue||!Array.isArray(r.orgs)||!Array.isArray(r.members)||!Array.isArray(r.devices)?void 0:{version:ue,orgs:r.orgs,members:r.members,devices:r.devices}}catch{return}}function Ue(e){return{version:e.version,orgs:e.orgs,members:e.members,devices:e.devices.map(t=>({id:t.id,memberId:t.memberId,name:t.name,platform:t.platform,grants:t.grants,createdAt:t.createdAt,lastSeenAt:t.lastSeenAt,revokedAt:t.revokedAt}))}}var re=require("node:crypto"),je={authorize:"https://accounts.feishu.cn/open-apis/authen/v1/authorize",token:"https://open.feishu.cn/open-apis/authen/v2/oauth/token",userinfo:"https://open.feishu.cn/open-apis/authen/v1/user_info"};function ve(e){return e.toString("base64url")}function ae(e,t){return ve((0,re.createHmac)("sha256",e).update(t,"utf8").digest())}function Fe(e,t){let r=Buffer.from(e,"utf8"),o=Buffer.from(t,"utf8");return r.length===o.length&&(0,re.timingSafeEqual)(r,o)}function Ke(e,t){let r={...je,...e.endpoints},o=new URL(r.authorize);return o.searchParams.set("client_id",e.appId),o.searchParams.set("app_id",e.appId),o.searchParams.set("redirect_uri",e.redirectUri),o.searchParams.set("response_type","code"),o.searchParams.set("state",t),o.toString()}function Ge(e,t,r=10*6e4){let o=`${t}.${Date.now()+r}`;return`${ve(Buffer.from(o,"utf8"))}.${ae(e,o)}`}function Ve(e,t,r=[]){if(!t)return{valid:!1};let o=t.lastIndexOf(".");if(o<=0)return{valid:!1};let d=t.slice(0,o),i=t.slice(o+1),g;try{g=Buffer.from(d,"base64url").toString("utf8")}catch{return{valid:!1}}if(!Fe(ae(e,g),i))return{valid:!1};let p=g.lastIndexOf("."),f=Number(g.slice(p+1));if(!Number.isFinite(f)||f<=Date.now())return{valid:!1};let k=p>0?g.slice(0,p):"",A=k.indexOf("~"),P=A>0?k.slice(A+1):"";return P&&r.includes(P)?{valid:!0,next:P}:{valid:!0}}function Je(e,t){let r=ve(Buffer.from(JSON.stringify(t),"utf8"));return`${r}.${ae(e,r)}`}function ie(e,t){if(!t)return;let r=t.lastIndexOf(".");if(r<=0)return;let o=t.slice(0,r),d=t.slice(r+1);if(Fe(ae(e,o),d))try{let i=JSON.parse(Buffer.from(o,"base64url").toString("utf8"));return!i.memberId||typeof i.exp!="number"||i.exp<=Date.now()?void 0:i}catch{return}}function ne(e){if(!e||typeof e!="object")return{};let t=e,r=t.data;return r&&typeof r=="object"?r:t}function M(e){return typeof e=="string"&&e.trim()?e.trim():void 0}async function qe(e,t,r=fetch){let o={...je,...e.endpoints},d=[{grant_type:"authorization_code",client_id:e.appId,client_secret:e.appSecret,code:t,redirect_uri:e.redirectUri},{grant_type:"authorization_code",app_id:e.appId,app_secret:e.appSecret,code:t}],i="\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE access_token";for(let g of d)try{let p=await r(o.token,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(g)}),f=await p.json().catch(()=>{}),k=M(ne(f).access_token);if(!p.ok||!k){i=M(ne(f).error_description)??M(ne(f).msg)??`HTTP ${p.status}`;continue}let P=await(await r(o.userinfo,{headers:{authorization:`Bearer ${k}`}})).json().catch(()=>{}),v=ne(P),z=M(v.name)??M(v.en_name);if(!z){i="\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE\u7528\u6237\u59D3\u540D";continue}return{ok:!0,identity:{name:z,...M(v.email)??M(v.enterprise_email)?{email:M(v.email)??M(v.enterprise_email)}:{},...M(v.open_id)?{openId:M(v.open_id)}:{},...M(v.union_id)?{unionId:M(v.union_id)}:{}}}}catch(p){i=p instanceof Error?p.message:String(p)}return{ok:!1,error:i}}function We(e,t){if(!t.length)return!0;if(!e)return!1;let r=e.lastIndexOf("@");if(r<0)return!1;let o=e.slice(r+1).toLowerCase();return t.some(d=>d.trim().toLowerCase().replace(/^@/,"")===o)}var bt="1",xt=96*1024,Ye=9e4;function Xe(e){return(0,N.createHash)("sha256").update(e,"utf8").digest("hex")}function l(e,t,r,o={}){let d=JSON.stringify(r);e.writeHead(t,{"content-type":"application/json; charset=utf-8","content-length":Buffer.byteLength(d),"cache-control":"no-store","x-content-type-options":"nosniff",...o}),e.end(d)}function V(e){return new Promise(t=>{let r=[],o=0;e.on("data",d=>{if(o+=d.length,o>xt){t(void 0),e.destroy();return}r.push(d)}),e.on("end",()=>t(Buffer.concat(r).toString("utf8"))),e.on("error",()=>t(void 0))})}function J(e){let t=e.headers.authorization??"";return/^Bearer\s+(.+)$/i.exec(t.trim())?.[1]?.trim()??""}function E(e){let t=e.headers["x-real-ip"];if(typeof t=="string"&&t.trim())return t.trim();let r=e.headers["x-forwarded-for"];return typeof r=="string"&&r.trim()?r.split(",")[0].trim():(e.socket.remoteAddress??"").replace(/^::ffff:/,"")}async function Qe(e={}){let t=Math.max(20,e.maxMessages??500),r=Math.max(1e3,Math.min(e.maxWaitMs??22e3,25e3)),o=Math.max(10,e.rateLimit??240),d=e.log??(()=>{}),i=new X(e.audit),g=new Map,p=new Map,f=ye(e.historyDir,t),k=(n,a)=>(n.ready||(n.ready=f.load(a).then(S=>{if(!S.length)return;let x=new Set(n.messages.map(C=>C.id));for(let C of S)x.has(C.id)||(n.messages.push({seq:C.seq,id:C.id,from:C.from,envelope:{iv:C.iv,ct:C.ct},at:C.at}),n.seen.add(C.id),C.seq>n.seq&&(n.seq=C.seq));n.messages.sort((C,O)=>C.seq-O.seq),n.messages.length>t&&(n.messages=n.messages.slice(-t)),d(`[relay] \u9891\u9053 ${a.slice(0,8)}\u2026 \u4ECE\u78C1\u76D8\u6062\u590D ${S.length} \u6761\uFF0Cseq=${n.seq}`)}).catch(()=>{})),n.ready),A=(n,a)=>{let S=g.get(n);if(S)return S.keyHash===Xe(a)?S:void 0;if(!/^[0-9a-f]{16,64}$/.test(n))return;let x={keyHash:Xe(a),createdAt:Date.now(),seq:0,messages:[],waiters:[],seen:new Set,presence:new Map};return g.set(n,x),k(x,n),d(`[relay] \u65B0\u9891\u9053 ${n.slice(0,8)}\u2026`),x},P=n=>{let a=Date.now(),S=p.get(n);return!S||a>=S.resetAt?(p.set(n,{count:1,resetAt:a+6e4}),!0):(S.count+=1,S.count<=o)},v=e.identity,z=e.adminToken??"",q=n=>{if(!/^[0-9a-f]{16,64}$/.test(n))return;let a=g.get(n);if(a)return a;let S={keyHash:"",createdAt:Date.now(),seq:0,messages:[],waiters:[],seen:new Set,presence:new Map};return g.set(n,S),k(S,n),d(`[relay] \u65B0\u9891\u9053 ${n.slice(0,8)}\u2026\uFF08\u8EAB\u4EFD\u6A21\u5F0F\uFF09`),S},F=(n,a,S)=>{if(!v)return{ok:!0};let x=J(n);if(x){let U=Le(v.state,x,a,S);return U.ok?{ok:!0,deviceId:U.device?.id,member:U.member?.name}:{ok:!1,status:403,reason:U.reason??"\u672A\u6388\u6743"}}let C=e.auth;if(!C)return{ok:!1,status:403,reason:"\u8BBE\u5907\u4EE4\u724C\u65E0\u6548"};let O=ie(C.secret,Q(n.headers.cookie).plaitcode_session);if(!O)return{ok:!1,status:401,reason:"\u672A\u767B\u5F55\uFF1A\u8BF7\u5148\u7528\u98DE\u4E66\u767B\u5F55"};let K=ze(v.state,O.memberId,a,S);return K.ok?{ok:!0,member:K.member?.name}:{ok:!1,status:403,reason:K.reason??"\u672A\u6388\u6743"}},$=async()=>{v?.path&&await Ne(v.path,v.state).catch(n=>{d(`[relay] \u8EAB\u4EFD\u5E93\u5199\u5165\u5931\u8D25\uFF1A${n instanceof Error?n.message:String(n)}`)})},W=n=>{if(!z||typeof n!="string")return!1;let a=(0,N.createHash)("sha256").update(n).digest(),S=(0,N.createHash)("sha256").update(z).digest();return a.length===S.length&&(0,N.timingSafeEqual)(a,S)},Y=async(n,a)=>{let S=a.orgs.find(s=>s.id===n.orgId),x=a.members.filter(s=>s.orgId===n.orgId),C=new Set(x.map(s=>s.id)),O=a.devices.filter(s=>C.has(s.memberId)),K=new Map(x.map(s=>[s.id,s.name])),U=Date.now(),le=s=>{let y=g.get(s),I=new Set;if(!y)return I;for(let[w,T]of y.presence)U-T.at<=Ye&&I.add(w);return I},m=new Set;for(let s of O)for(let y of s.grants)m.add(y.channelId);let u=new Set;for(let s of m)for(let y of le(s))u.add(y);let c=[...m].sort().map(s=>{let y=O.filter(G=>G.grants.some(dt=>dt.channelId===s)),I=le(s),w=y.filter(G=>I.has(G.id)&&!G.revokedAt),T=g.get(s),D=T?.messages.length?T.messages[T.messages.length-1]:void 0;return{channelId:s,devices:y.length,online:w.length,deviceNames:w.map(G=>G.name).slice(0,8),...D?{lastMessageAt:D.at}:{}}}),h=(await i.tail(300)).filter(s=>typeof s.channel=="string"&&m.has(s.channel)).slice(0,120);return{ok:!0,member:{id:n.id,name:n.name,role:n.role,email:n.email??null},org:S?{id:S.id,name:S.name}:null,members:x.map(s=>({id:s.id,name:s.name,role:s.role,email:s.email??null,createdAt:s.createdAt})),devices:O.map(s=>({id:s.id,memberId:s.memberId,memberName:K.get(s.memberId)??"",name:s.name,platform:s.platform,grants:s.grants,createdAt:s.createdAt,...s.lastSeenAt?{lastSeenAt:s.lastSeenAt}:{},...s.expiresAt?{expiresAt:s.expiresAt}:{},...s.revokedAt?{revokedAt:s.revokedAt}:{},online:u.has(s.id)&&!s.revokedAt})),channels:c,audit:h,counts:{devices:O.filter(s=>!s.revokedAt).length,online:O.filter(s=>!s.revokedAt&&u.has(s.id)).length,channels:c.length,members:x.length}}},_=(0,Ze.createServer)((n,a)=>{(async()=>{let S=n.url??"/",x=S.split("?")[0]??"/",C=new URLSearchParams(S.slice(S.indexOf("?")+1)),O=x==="/health";if(!(O||(x==="/manifest.webmanifest"||x==="/sw.js"||x==="/icon.svg")||(x==="/"||x==="/m"||x==="/console"))){let m=E(n);if(!P(m)){i.record({event:"denied",ip:m,detail:"rate limited"}),l(a,429,{ok:!1,error:"too many requests"});return}}if(n.method==="GET"&&x==="/"){let m=Ae({relayHost:typeof n.headers.host=="string"?n.headers.host:"plaitcode.com",consoleEnabled:!!(e.auth&&v),installUrl:"https://marketplace.visualstudio.com/items?itemName=plaitcode.plaitcode",repoUrl:"https://github.com/Gsaecy/PlaitCode"});a.writeHead(200,{"content-type":"text/html; charset=utf-8","content-length":Buffer.byteLength(m),"cache-control":"public, max-age=300","x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"no-referrer"}),a.end(m);return}if(n.method==="GET"&&x==="/console"){let m=Te({relayHost:typeof n.headers.host=="string"?n.headers.host:"plaitcode.com",sessionAuth:!!(e.auth&&v)});a.writeHead(200,{"content-type":"text/html; charset=utf-8","content-length":Buffer.byteLength(m),"cache-control":"no-store","x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"no-referrer"}),a.end(m);return}if(n.method==="GET"&&x==="/m"){let m=Ce({relayHost:typeof n.headers.host=="string"?n.headers.host:"plaitcode.com",sessionAuth:!!v});a.writeHead(200,{"content-type":"text/html; charset=utf-8","content-length":Buffer.byteLength(m),"cache-control":"no-store","x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"no-referrer"}),a.end(m);return}if(n.method==="GET"&&x==="/manifest.webmanifest"){let m=Pe();a.writeHead(200,{"content-type":"application/manifest+json; charset=utf-8","content-length":Buffer.byteLength(m),"cache-control":"public, max-age=3600","x-content-type-options":"nosniff"}),a.end(m);return}if(n.method==="GET"&&x==="/sw.js"){a.writeHead(200,{"content-type":"application/javascript; charset=utf-8","content-length":Buffer.byteLength(pe),"cache-control":"no-cache","service-worker-allowed":"/","x-content-type-options":"nosniff"}),a.end(pe);return}if(n.method==="GET"&&x==="/icon.svg"){a.writeHead(200,{"content-type":"image/svg+xml; charset=utf-8","content-length":Buffer.byteLength(ce),"cache-control":"public, max-age=86400","x-content-type-options":"nosniff"}),a.end(ce);return}if(x==="/v1/auth/feishu/start"&&n.method==="GET"){let m=e.auth;if(!m||!v){l(a,404,{ok:!1,error:"sso disabled"});return}let u=C.get("next")==="console"?"console":"",c=Ge(m.secret,u?`${(0,N.randomUUID)()}~${u}`:(0,N.randomUUID)());a.writeHead(302,{location:Ke(m.config,c),"cache-control":"no-store"}),a.end();return}if(x==="/v1/auth/feishu/callback"&&n.method==="GET"){let m=e.auth;if(!m||!v){l(a,404,{ok:!1,error:"sso disabled"});return}let u=Ve(m.secret,C.get("state")??void 0,["console"]);if(!u.valid){i.record({event:"denied",ip:E(n),detail:"sso state invalid"}),l(a,400,{ok:!1,error:"state \u65E0\u6548\u6216\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55"});return}let c=C.get("code")??"";if(!c){l(a,400,{ok:!1,error:"\u7F3A\u5C11 code"});return}let b=await qe(m.config,c);if(!b.ok){i.record({event:"denied",ip:E(n),detail:`sso exchange failed: ${b.error}`}),l(a,502,{ok:!1,error:`\u98DE\u4E66\u767B\u5F55\u5931\u8D25\uFF1A${b.error}`});return}if(m.emailDomains?.length&&!b.identity.email){i.record({event:"denied",ip:E(n),detail:"sso email missing while domain allowlist configured"}),l(a,403,{ok:!1,error:"\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE\u90AE\u7BB1\uFF0C\u65E0\u6CD5\u6821\u9A8C\u57DF\u540D\u767D\u540D\u5355\u3002\u8BF7\u7ED9\u5E94\u7528\u5F00\u901A contact:user.email:readonly \u6743\u9650\u5E76\u53D1\u5E03\u7248\u672C\uFF0C\u6216\u628A PLAITCODE_AUTH_EMAIL_DOMAINS \u6E05\u7A7A\u3002"});return}if(!We(b.identity.email,m.emailDomains??[])){i.record({event:"denied",ip:E(n),detail:`sso email not allowed: ${b.identity.email??"(none)"}`}),l(a,403,{ok:!1,error:"\u8FD9\u4E2A\u90AE\u7BB1\u4E0D\u5728\u5141\u8BB8\u7684\u57DF\u540D\u5185"});return}let h=b.identity,s=He(v.state,h);if(!s&&(h.email||h.openId||h.unionId)){let w=v.state.orgs[0];if(!w){l(a,409,{ok:!1,error:"\u670D\u52A1\u7AEF\u8FD8\u6CA1\u6709\u7EC4\u7EC7\uFF0C\u8BF7\u7BA1\u7406\u5458\u5148\u5EFA\u7EC4\u7EC7"});return}s=me(v.state,{orgId:w.id,name:h.name,role:"member",email:h.email,openId:h.openId,unionId:h.unionId}),s&&(await $(),i.record({event:"admin",ip:E(n),detail:`auto-provision ${h.email??h.openId??h.unionId}`}))}if(!s){i.record({event:"denied",ip:E(n),detail:"sso identity has no stable key"}),l(a,409,{ok:!1,error:"\u65E0\u6CD5\u5EFA\u7ACB\u6210\u5458\u8EAB\u4EFD\uFF1A\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE\u53EF\u7528\u4E8E\u8BC6\u522B\u8EAB\u4EFD\u7684\u6807\u8BC6\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458"});return}h.email&&!s.email&&(s.email=h.email,await $());let y=m.sessionTtlMs??720*6e4,I=Je(m.secret,{memberId:s.id,name:s.name,...b.identity.email?{email:b.identity.email}:{},exp:Date.now()+y});i.record({event:"login",ip:E(n),detail:s.name}),a.writeHead(302,{location:u.next==="console"?"/console":"/m","set-cookie":`plaitcode_session=${I}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(y/1e3)}`,"cache-control":"no-store"}),a.end();return}if(x==="/v1/auth/me"&&n.method==="GET"){let m=e.auth;if(!m){l(a,404,{ok:!1,error:"sso disabled"});return}let u=ie(m.secret,Q(n.headers.cookie).plaitcode_session);if(!u){l(a,401,{ok:!1,error:"\u672A\u767B\u5F55"});return}l(a,200,{ok:!0,member:{id:u.memberId,name:u.name,email:u.email??null}});return}if(x==="/v1/auth/logout"&&n.method==="POST"){a.writeHead(200,{"content-type":"application/json; charset=utf-8","set-cookie":"plaitcode_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"}),a.end(JSON.stringify({ok:!0}));return}if(x==="/v1/devices/enroll"&&n.method==="POST"){if(!v){l(a,404,{ok:!1,error:"identity disabled"});return}if(e.selfEnroll===!1){l(a,403,{ok:!1,error:"self enrollment disabled"});return}let m=J(n),u=m?te(v.state,m):void 0,c=u&&!u.revokedAt&&(u.expiresAt===void 0||Date.now()<=u.expiresAt)?u:void 0;if(!c){i.record({event:"denied",ip:E(n),detail:"enroll auth failed"}),l(a,403,{ok:!1,error:"\u9700\u8981\u7528\u5DF2\u767B\u8BB0\u7684\u8BBE\u5907\u4EE4\u724C\u8C03\u7528"});return}let b=await V(n);if(b===void 0){l(a,413,{ok:!1,error:"body too large"});return}let h={};if(b)try{h=JSON.parse(b)}catch{l(a,400,{ok:!1,error:"invalid json"});return}let s=ge(v.state,{memberId:c.memberId,name:String(h.name??"\u65B0\u8BBE\u5907"),platform:typeof h.platform=="string"?h.platform:void 0,channels:c.grants.map(y=>({channelId:y.channelId,role:y.role}))});if(!s){l(a,409,{ok:!1,error:"\u6210\u5458\u4E0D\u5B58\u5728"});return}await $(),i.record({event:"admin",ip:E(n),detail:`self-enroll ${s.device.name}`}),l(a,200,{ok:!0,device:{id:s.device.id,name:s.device.name,grants:s.device.grants},token:s.token});return}if(x==="/v1/notify"&&n.method==="POST"){let m=e.notifyHook?.trim();if(!m){l(a,404,{ok:!1,error:"notify disabled"});return}let u=J(n),c=v&&u?te(v.state,u):void 0;if(v&&(!c||c.revokedAt)){i.record({event:"denied",ip:E(n),detail:"notify auth failed"}),l(a,403,{ok:!1,error:"\u9700\u8981\u7528\u5DF2\u767B\u8BB0\u7684\u8BBE\u5907\u4EE4\u724C\u8C03\u7528"});return}let b=await V(n);if(b===void 0){l(a,413,{ok:!1,error:"body too large"});return}let h={};try{h=b?JSON.parse(b):{}}catch{l(a,400,{ok:!1,error:"invalid json"});return}let s=h.kind==="approval"||h.kind==="done"||h.kind==="blocked"?h.kind:void 0;if(!s){l(a,400,{ok:!1,error:"kind must be approval/done/blocked"});return}let y={kind:s,title:String(h.title??"").slice(0,120),summary:String(h.summary??"").slice(0,500),...typeof h.source=="string"?{source:h.source.slice(0,120)}:{}},I=e.auth?.config?.redirectUri?(()=>{try{return new URL(e.auth.config.redirectUri).origin}catch{return""}})():"",w=await ke(m,y,I?`${I}/m`:"");i.record({event:"admin",ip:E(n),detail:`notify ${s} -> ${w.ok?"sent":`failed: ${w.error}`}`}),l(a,w.ok?200:502,w.ok?{ok:!0}:{ok:!1,error:w.error});return}if(x.startsWith("/v1/console/")){if(!v){l(a,404,{ok:!1,error:"identity disabled"});return}let m=e.auth;if(!m){l(a,404,{ok:!1,error:"sso disabled"});return}let u=ie(m.secret,Q(n.headers.cookie).plaitcode_session);if(!u){l(a,401,{ok:!1,error:"\u672A\u767B\u5F55",login:"/v1/auth/feishu/start?next=console"});return}let c=v.state.members.find(b=>b.id===u.memberId);if(!c){i.record({event:"denied",ip:E(n),detail:"console member missing"}),l(a,403,{ok:!1,error:"\u6210\u5458\u4E0D\u5B58\u5728\u6216\u5DF2\u88AB\u79FB\u9664"});return}if(x==="/v1/console/state"&&n.method==="GET"){l(a,200,await Y(c,v.state));return}if(x==="/v1/console/devices/revoke"&&n.method==="POST"){let b=await V(n);if(b===void 0){l(a,413,{ok:!1,error:"body too large"});return}let h={};if(b)try{h=JSON.parse(b)}catch{l(a,400,{ok:!1,error:"invalid json"});return}let s=String(h.deviceId??""),y=v.state.devices.find(T=>T.id===s);if(!y){l(a,404,{ok:!1,error:"\u8BBE\u5907\u4E0D\u5B58\u5728"});return}let I=v.state.members.find(T=>T.id===y.memberId);if(!I||I.orgId!==c.orgId){l(a,404,{ok:!1,error:"\u8BBE\u5907\u4E0D\u5B58\u5728"});return}if(y.memberId!==c.id&&!ee(c.role,"manage")){i.record({event:"denied",ip:E(n),detail:`console revoke denied: ${c.name}`}),l(a,403,{ok:!1,error:"\u53EA\u6709\u7BA1\u7406\u5458\u80FD\u540A\u9500\u522B\u4EBA\u7684\u8BBE\u5907"});return}let w=he(v.state,s);w&&await $(),i.record({event:"admin",ip:E(n),detail:`console revoke ${y.name} by ${c.name} -> ${w}`}),l(a,w?200:404,{ok:w});return}l(a,404,{ok:!1,error:"not found"});return}if(x.startsWith("/v1/admin/")){if(!v||!z){l(a,404,{ok:!1,error:"admin api disabled"});return}if(!W(n.headers["x-plaitcode-admin"])){i.record({event:"denied",ip:E(n),detail:"admin auth failed"}),l(a,403,{ok:!1,error:"admin denied"});return}let m=n.method==="POST"?await V(n):"";if(m===void 0){l(a,413,{ok:!1,error:"body too large"});return}let u={};if(m)try{u=JSON.parse(m)}catch{l(a,400,{ok:!1,error:"invalid json"});return}if(x==="/v1/admin/state"&&n.method==="GET"){l(a,200,{ok:!0,identity:Ue(v.state)});return}if(x==="/v1/admin/orgs"&&n.method==="POST"){let c=Re(v.state,String(u.name??""));await $(),i.record({event:"admin",ip:E(n),detail:`org ${c.name}`}),l(a,200,{ok:!0,org:c});return}if(x==="/v1/admin/members"&&n.method==="POST"){let c=me(v.state,{orgId:String(u.orgId??""),name:String(u.name??""),role:u.role});if(!c){l(a,404,{ok:!1,error:"org not found"});return}await $(),i.record({event:"admin",ip:E(n),detail:`member ${c.name} (${c.role})`}),l(a,200,{ok:!0,member:c});return}if(x==="/v1/admin/devices"&&n.method==="POST"){let c=Array.isArray(u.channels)?u.channels:[],b=ge(v.state,{memberId:String(u.memberId??""),name:String(u.name??""),platform:typeof u.platform=="string"?u.platform:void 0,channels:c.filter(h=>!!h&&typeof h=="object").map(h=>({channelId:String(h.channelId??""),role:h.role}))});if(!b){l(a,404,{ok:!1,error:"member not found"});return}await $(),i.record({event:"admin",ip:E(n),detail:`device ${b.device.name} for ${b.device.memberId}`}),l(a,200,{ok:!0,device:{id:b.device.id,memberId:b.device.memberId,name:b.device.name,grants:b.device.grants},token:b.token});return}if(x==="/v1/admin/devices/revoke"&&n.method==="POST"){let c=he(v.state,String(u.deviceId??""));await $(),i.record({event:"admin",ip:E(n),detail:`revoke ${String(u.deviceId??"")} -> ${c}`}),l(a,c?200:404,{ok:c});return}l(a,404,{ok:!1,error:"not found"});return}if(n.method==="GET"&&O){l(a,200,{ok:!0,service:"plaitcode-relay",version:bt,channels:g.size,uptime:Math.round(process.uptime())});return}if(!x.startsWith("/v1/")){l(a,404,{ok:!1,error:"not found"});return}if(n.method==="GET"&&x==="/v1/poll"){let m=C.get("channel")??"",u=F(n,m,"poll");if(!u.ok){i.record({event:"denied",channel:m.slice(0,32),ip:E(n),detail:u.reason}),l(a,u.status,{ok:!1,error:u.reason});return}let c=v?q(m):A(m,J(n));if(!c){l(a,403,{ok:!1,error:"channel denied"});return}c.ready&&await c.ready;let b=Number(C.get("since")??0)||0,h=Math.min(Math.max(Number(C.get("wait")??20)*1e3||2e4,0),r),s=()=>c.messages.filter(D=>D.seq>b),y=s();if(y.length||h===0){l(a,200,{ok:!0,messages:y.slice(-200),seq:c.seq});return}let I=!1,w=()=>{if(I)return;I=!0;let D=c.waiters.indexOf(w);D>=0&&c.waiters.splice(D,1),clearTimeout(T),!a.writableEnded&&l(a,200,{ok:!0,messages:s().slice(-200),seq:c.seq})},T=setTimeout(w,h);T.unref?.(),c.waiters.push(w),n.on("close",()=>{if(I)return;I=!0;let D=c.waiters.indexOf(w);D>=0&&c.waiters.splice(D,1),clearTimeout(T)});return}if(n.method==="POST"&&x==="/v1/publish"){let m=await V(n);if(!m){l(a,413,{ok:!1,error:"body too large"});return}let u;try{u=JSON.parse(m)}catch{l(a,400,{ok:!1,error:"invalid json"});return}let c=typeof u.channel=="string"?u.channel:"",b=typeof u.id=="string"?u.id.slice(0,80):"",h=typeof u.from=="string"?u.from.slice(0,80):"",s=typeof u.envelope?.iv=="string"?u.envelope.iv:"",y=typeof u.envelope?.ct=="string"?u.envelope.ct:"";if(!b||!h||!s||!y||y.length>64*1024){l(a,400,{ok:!1,error:"invalid message"});return}let I=F(n,c,"publish");if(!I.ok){i.record({event:"denied",channel:c.slice(0,32),ip:E(n),detail:I.reason}),l(a,I.status,{ok:!1,error:I.reason});return}let w=v?q(c):A(c,J(n));if(!w){i.record({event:"denied",channel:c.slice(0,32),ip:E(n),detail:"channel denied"}),l(a,403,{ok:!1,error:"channel denied"});return}if(w.ready&&await w.ready,w.seen.has(b)){i.record({event:"publish",channel:c,device:h,message:b,ip:E(n),detail:"duplicate"}),l(a,200,{ok:!0,duplicate:!0,seq:w.seq});return}w.seq+=1,w.seen.add(b),i.record({event:"publish",channel:c,device:h,message:b,ip:E(n),bytes:y.length}),w.seen.size>t*4&&(w.seen=new Set([...w.seen].slice(-t*2)));let T={seq:w.seq,id:b,from:h,envelope:{iv:s,ct:y},at:Date.now()};w.messages.push(T),f.append(c,{seq:T.seq,id:T.id,from:T.from,iv:s,ct:y,at:T.at}),w.messages.length>t&&(w.messages=w.messages.slice(-t));for(let D of[...w.waiters])D();l(a,200,{ok:!0,seq:w.seq});return}if(x==="/v1/presence"){let m=J(n),u=C.get("channel")??"",c;if(n.method==="POST"){let y=await V(n);if(!y){l(a,413,{ok:!1,error:"body too large"});return}let I;try{I=JSON.parse(y)}catch{l(a,400,{ok:!1,error:"invalid json"});return}u=typeof I.channel=="string"?I.channel:"",c=I.device}let b=F(n,u,"presence");if(!b.ok){i.record({event:"denied",channel:u.slice(0,32),ip:E(n),detail:b.reason}),l(a,b.status,{ok:!1,error:b.reason});return}let h=v?q(u):A(u,m);if(!h){l(a,403,{ok:!1,error:"channel denied"});return}if(c){let y=b.deviceId??(typeof c.id=="string"?c.id.slice(0,80):"");if(!y){l(a,400,{ok:!1,error:"invalid device"});return}h.presence.set(y,{name:b.member?`${b.member} \xB7 ${typeof c.name=="string"?c.name.slice(0,60):"\u8BBE\u5907"}`:typeof c.name=="string"?c.name.slice(0,120):y,platform:typeof c.platform=="string"?c.platform:"unknown",project:typeof c.project=="string"?c.project.slice(0,120):"",at:Date.now()})}let s=Date.now();for(let[y,I]of h.presence)s-I.at>Ye&&h.presence.delete(y);l(a,200,{ok:!0,devices:[...h.presence.entries()].map(([y,I])=>({id:y,...I}))});return}l(a,404,{ok:!1,error:"not found"})})().catch(S=>{d(`[relay] \u8BF7\u6C42\u5904\u7406\u5931\u8D25\uFF1A${S instanceof Error?S.message:String(S)}`),a.writableEnded||l(a,500,{ok:!1,error:"internal error"})})});await new Promise((n,a)=>{_.once("error",a),_.listen(e.port??8787,e.host??"0.0.0.0",()=>{_.off("error",a),n()})});let se=_.address(),de=se&&typeof se=="object"?se.port:e.port??8787;return d(`[relay] \u76D1\u542C ${e.host??"0.0.0.0"}:${de}`),i.record({event:"startup",detail:`listen ${e.host??"0.0.0.0"}:${de}`}),{port:de,close:()=>new Promise(n=>{i.record({event:"shutdown"});for(let a of g.values())for(let S of[...a.waiters])S();_.close(()=>{Promise.all([i.flush(),f.flush()]).then(()=>n())}),setTimeout(()=>n(),1500).unref?.()})}}var tt=require("node:dgram"),nt=require("node:http"),rt=require("node:https"),at=require("node:net");function it(e){let t=(e??"").trim();if(t)try{if(/^otlp\+https?:\/\//i.test(t))return{kind:"otlp",url:new URL(t.replace(/^otlp\+/i,""))};if(/^syslog\+tcp:\/\//i.test(t))return{kind:"syslog-tcp",url:new URL(t.replace(/^syslog\+tcp:/i,"http:"))};if(/^syslog:\/\//i.test(t))return{kind:"syslog",url:new URL(t.replace(/^syslog:/i,"http:"))};if(/^https?:\/\//i.test(t))return{kind:"webhook",url:new URL(t)}}catch{return}}function et(e,t,r){let o;try{o=e}catch{return}let d=Buffer.from(t,"utf8"),g=(o.protocol==="https:"?rt.request:nt.request)(o,{method:"POST",headers:{"content-type":"application/json","content-length":String(d.length)},timeout:r},p=>{p.resume()});g.on("timeout",()=>g.destroy()),g.on("error",()=>{}),g.end(d)}function yt(e,t){let r=`${Date.now()}000000`;try{let o=JSON.parse(e);if(typeof o.ts=="string"){let d=Date.parse(o.ts);Number.isFinite(d)&&(r=`${d}000000`)}}catch{}return JSON.stringify({resourceLogs:[{resource:{attributes:[{key:"service.name",value:{stringValue:"plaitcode-relay"}},{key:"host.name",value:{stringValue:t}}]},scopeLogs:[{scope:{name:"plaitcode.audit"},logRecords:[{timeUnixNano:r,severityText:"INFO",body:{stringValue:e}}]}]}]})}function ot(e,t={}){let r=t.hostname??"plaitcode-relay";if(e.kind==="webhook")return{send:p=>et(e.url,p,5e3),close:()=>{}};if(e.kind==="otlp")return{send:p=>et(e.url,yt(p,r),5e3),close:()=>{}};let o=e.url.hostname,d=Number(e.url.port||514);if(e.kind==="syslog"){let p=(0,tt.createSocket)("udp4");return p.on("error",()=>{}),p.unref?.(),{send:f=>{let k=`<14>1 - ${r} plaitcode-relay - AUDIT - ${f}`;try{p.send(Buffer.from(k,"utf8"),d,o,()=>{})}catch{}},close:()=>{try{p.close()}catch{}}}}let i,g=()=>(i&&!i.destroyed||(i=(0,at.connect)(d,o,()=>{}),i.on("error",()=>{i=void 0}),i.on("close",()=>{i=void 0}),i.unref?.()),i);return{send:p=>{let f=g();if(f)try{f.write(`<14>1 - ${r} plaitcode-relay - AUDIT - ${p}
`)}catch{i=void 0}},close:()=>{try{i?.destroy()}catch{}}}}var st=require("node:os"),oe=require("node:path");async function kt(){let e=Number(process.env.PLAITCODE_PORT??8787),t=process.env.PLAITCODE_HOST??"127.0.0.1",r=process.env.PLAITCODE_AUDIT??"/var/lib/plaitcode-relay/audit.jsonl",o=process.env.PLAITCODE_AUDIT_STDOUT!=="0",d=process.env.PLAITCODE_IDENTITY?.trim(),i=process.env.PLAITCODE_ADMIN_TOKEN?.trim()??"",g=process.env.PLAITCODE_HISTORY?.trim(),p=g==="-"?void 0:g||(r!=="-"?(0,oe.join)((0,oe.dirname)(r),"channels"):"/var/lib/plaitcode-relay/channels"),f=d?{state:await Be(d)??Me(),path:d}:void 0;f&&(console.log(`[relay] \u8EAB\u4EFD\u6A21\u5F0F\uFF1A${f.state.orgs.length} \u7EC4\u7EC7 / ${f.state.members.length} \u6210\u5458 / ${f.state.devices.length} \u8BBE\u5907`),i||console.log("[relay] \u8B66\u544A\uFF1A\u6CA1\u8BBE PLAITCODE_ADMIN_TOKEN\uFF0C\u7BA1\u7406\u63A5\u53E3\u4E0D\u53EF\u7528"));let k=it(process.env.PLAITCODE_AUDIT_SINK),A=k?ot(k,{hostname:(0,st.hostname)()}):void 0;k&&console.log(`[relay] \u5BA1\u8BA1\u5916\u9001\uFF1A${k.kind} \u2192 ${k.url.host}`);let P=process.env.PLAITCODE_FEISHU_APP_ID?.trim()??"",v=process.env.PLAITCODE_FEISHU_APP_SECRET?.trim()??"",z=process.env.PLAITCODE_AUTH_SECRET?.trim()??"",q=(process.env.PLAITCODE_PUBLIC_URL?.trim()||"https://plaitcode.com").replace(/\/+$/,""),F=P&&v?{appId:P,appSecret:v,redirectUri:`${q}/v1/auth/feishu/callback`,...process.env.PLAITCODE_FEISHU_AUTHORIZE?{endpoints:{authorize:process.env.PLAITCODE_FEISHU_AUTHORIZE}}:{},...process.env.PLAITCODE_FEISHU_TOKEN?{endpoints:{token:process.env.PLAITCODE_FEISHU_TOKEN}}:{},...process.env.PLAITCODE_FEISHU_USERINFO?{endpoints:{userinfo:process.env.PLAITCODE_FEISHU_USERINFO}}:{}}:void 0,$=F&&z&&f?{config:F,secret:z,emailDomains:(process.env.PLAITCODE_AUTH_EMAIL_DOMAINS??"").split(",").map(_=>_.trim()).filter(Boolean)}:void 0;$?console.log("[relay] \u98DE\u4E66\u767B\u5F55\u5DF2\u542F\u7528"):P&&console.log("[relay] \u8B66\u544A\uFF1A\u98DE\u4E66\u767B\u5F55\u9700\u8981 PLAITCODE_AUTH_SECRET \u4E0E\u8EAB\u4EFD\u5E93\uFF08PLAITCODE_IDENTITY\uFF09"),process.env.PLAITCODE_FEISHU_WEBHOOK?.trim()&&console.log("[relay] \u98DE\u4E66\u673A\u5668\u4EBA\u901A\u77E5\u5DF2\u542F\u7528");let W=await Qe({port:Number.isFinite(e)&&e>0?e:8787,host:t,log:_=>console.log(_),...f?{identity:f}:{},...i?{adminToken:i}:{},...$?{auth:$}:{},...p?{historyDir:p}:{},...process.env.PLAITCODE_SELF_ENROLL==="0"?{selfEnroll:!1}:{},...process.env.PLAITCODE_FEISHU_WEBHOOK?.trim()?{notifyHook:process.env.PLAITCODE_FEISHU_WEBHOOK.trim()}:{},audit:{...r&&r!=="-"?{path:r}:{},sink:(_=>{o&&console.log(`[audit] ${_}`),A?.send(_)}),includeIp:process.env.PLAITCODE_AUDIT_IP!=="0",maxBytes:Number(process.env.PLAITCODE_AUDIT_MAX_BYTES??20*1024*1024),keep:Number(process.env.PLAITCODE_AUDIT_KEEP??5)}});console.log(`[relay] ready on http://${t}:${W.port}`);let Y=_=>{console.log(`[relay] ${_}\uFF0C\u6B63\u5728\u5173\u95ED`),A?.close(),W.close().then(()=>process.exit(0))};process.on("SIGTERM",()=>Y("SIGTERM")),process.on("SIGINT",()=>Y("SIGINT"))}kt().catch(e=>{console.error(`[relay] \u542F\u52A8\u5931\u8D25\uFF1A${e instanceof Error?e.message:String(e)}`),process.exit(1)});
