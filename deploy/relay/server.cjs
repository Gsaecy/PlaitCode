"use strict";var F=require("node:crypto"),Fe=require("node:http");var $=require("node:fs/promises"),ue=require("node:path"),W=class{constructor(t={}){this.options=t;this.maxBytes=Math.max(4*1024,t.maxBytes??20*1024*1024),this.keep=Math.max(1,Math.min(t.keep??3,20)),this.includeIp=t.includeIp??!0}options;maxBytes;keep;includeIp;queue=Promise.resolve();written=0;record(t){let n={ts:(this.options.now?.()??new Date).toISOString(),event:t.event,...t.channel?{channel:t.channel}:{},...t.device?{device:t.device}:{},...t.message?{message:t.message}:{},...t.ip&&this.includeIp?{ip:t.ip}:{},...typeof t.bytes=="number"?{bytes:t.bytes}:{},...t.detail?{detail:t.detail}:{}},a=`${JSON.stringify(n)}
`;try{this.options.sink?.(a.trimEnd())}catch{}let s=this.options.path;s&&(this.queue=this.queue.then(()=>this.append(s,a)).catch(()=>{}))}async flush(){await this.queue.catch(()=>{})}async append(t,n){let a=Buffer.byteLength(n);this.written===0&&(this.written=await(0,$.stat)(t).then(s=>s.size).catch(()=>0)),this.written+a>this.maxBytes&&(await this.rotate(t),this.written=0),await(0,$.mkdir)((0,ue.dirname)(t),{recursive:!0}).catch(()=>{}),await(0,$.appendFile)(t,n,"utf8"),this.written+=a}async rotate(t){for(let n=this.keep;n>=1;n-=1){let a=n===1?t:`${t}.${n-1}`,s=`${t}.${n}`;await(0,$.rename)(a,s).catch(()=>{})}}};var D=require("node:fs/promises"),pe=require("node:path"),Ze=/^[0-9a-f]{16,64}$/;function fe(e,t=500){if(!e)return{load:async()=>[],append:()=>{},flush:async()=>{}};let n=new Map,a=i=>Ze.test(i)?(0,pe.join)(e,`${i}.jsonl`):void 0,s=i=>{let m=[];for(let u of i.split(`
`))if(u.trim())try{let p=JSON.parse(u);if(typeof p.seq!="number"||!Number.isFinite(p.seq)||typeof p.id!="string"||!p.id||typeof p.iv!="string"||typeof p.ct!="string")continue;m.push({seq:p.seq,id:p.id,from:typeof p.from=="string"?p.from:"",iv:p.iv,ct:p.ct,at:typeof p.at=="number"&&Number.isFinite(p.at)?p.at:0})}catch{}return m.sort((u,p)=>u.seq-p.seq)};return{async load(i){let m=a(i);if(!m)return[];let u;try{u=await(0,D.readFile)(m,"utf8")}catch{return[]}let p=s(u),y=t>0?p.slice(-t):p;if(p.length>y.length*2&&y.length>0){let C=y.map(h=>JSON.stringify(h)).join(`
`),P=`${m}.tmp`;await(0,D.writeFile)(P,`${C}
`,"utf8").catch(()=>{}),await(0,D.rename)(P,m).catch(()=>{})}return y},append(i,m){let u=a(i);if(!u)return;let p=`${JSON.stringify(m)}
`,C=(n.get(i)??Promise.resolve()).then(async()=>{await(0,D.mkdir)(e,{recursive:!0}).catch(()=>{}),await(0,D.appendFile)(u,p,"utf8")}).catch(()=>{});n.set(i,C),C.then(()=>{n.get(i)===C&&n.delete(i)})},async flush(){await Promise.all([...n.values()])}}}var et={approval:"\u9700\u8981\u4F60\u6279\u51C6",done:"\u4EFB\u52A1\u5B8C\u6210",blocked:"\u672A\u6267\u884C"},tt={approval:"\u23F3",done:"\u2705",blocked:"\u26A0\uFE0F"};function nt(e,t){return[`${tt[e.kind]} PlaitCode \xB7 ${et[e.kind]}`,e.title?`\u4E8B\u9879\uFF1A${e.title}`:"",e.summary?`\u8BE6\u60C5\uFF1A${e.summary}`:"",e.source?`\u6765\u81EA\uFF1A${e.source}`:"",t?`\u6253\u5F00\uFF1A${t}`:""].filter(Boolean).join(`
`)}async function me(e,t,n,a=5e3){if(!/^https:\/\//i.test(e))return{ok:!1,error:"webhook \u5FC5\u987B\u662F https \u5730\u5740"};try{let s=await fetch(e,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({msg_type:"text",content:{text:nt(t,n)}}),signal:AbortSignal.timeout(a)});if(!s.ok)return{ok:!1,error:`HTTP ${s.status}`};let i=await s.json().catch(()=>{}),m=i?.code??i?.StatusCode??0;return m!==0?{ok:!1,error:i?.msg??`code ${m}`}:{ok:!0}}catch(s){return{ok:!1,error:s instanceof Error?s.message:String(s)}}}var ge="plaitcode/channel/1:",he="plaitcode/relay/1:",ve="plaitcode/enc/1:";function be(e){let t=e.relayHost.replace(/[<>&"]/g,""),n=e.sessionAuth===!0;return`<!doctype html>
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
    return Promise.all([digest('${ge}'), digest('${he}'), digest('${ve}')])
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
</html>`}var ne=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="PlaitCode">
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
</svg>`;function ye(){return JSON.stringify({name:"PlaitCode \xB7 \u56E2\u961F\u7FA4",short_name:"PlaitCode",description:"\u5728\u624B\u673A\u4E0A\u6307\u6325\u7535\u8111\u4E0A\u7684\u7F16\u7801 agent\uFF1A\u63D0\u9700\u6C42\u3001\u770B\u8FDB\u5EA6\u3001\u6279\u51C6\u64CD\u4F5C\u3002",start_url:"/m",scope:"/",display:"standalone",orientation:"portrait",background_color:"#0f1115",theme_color:"#0f1115",lang:"zh-CN",icons:[{src:"/icon.svg",sizes:"any",type:"image/svg+xml",purpose:"any"},{src:"/icon.svg",sizes:"any",type:"image/svg+xml",purpose:"maskable"}]},null,2)}var re=`/* PlaitCode PWA service worker */
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
`;var yt=10*6e4,xt=720*6e4;var kt=5*6e4;function ie(e){let t={};for(let n of(e??"").split(";")){let a=n.indexOf("=");if(a<=0)continue;let s=n.slice(0,a).trim();s&&(t[s]=decodeURIComponent(n.slice(a+1).trim()))}return t}var U=require("node:crypto"),N=require("node:fs/promises"),ke=require("node:path"),oe=1,rt=100,it=0,St=1440*6e4;function we(){return{version:oe,orgs:[],members:[],devices:[]}}function ae(e){return`${e}_${(0,U.randomBytes)(9).toString("base64url")}`}function ot(){return`pct_${(0,U.randomBytes)(24).toString("base64url")}`}function Se(e){return(0,U.createHash)("sha256").update(e,"utf8").digest("hex")}function xe(e,t){let n=Buffer.from(e,"utf8"),a=Buffer.from(t,"utf8");return n.length===a.length&&(0,U.timingSafeEqual)(n,a)}var at={viewer:["poll","presence"],member:["publish","poll","presence"],admin:["publish","poll","presence","manage"],owner:["publish","poll","presence","manage"]};function Ie(e,t){return(at[e]??[]).includes(t)}function Ee(e){return e==="owner"||e==="admin"||e==="member"||e==="viewer"}function Ae(e,t){let n={id:ae("org"),name:t.trim().slice(0,80)||"org",createdAt:Date.now()};return e.orgs.push(n),n}function se(e,t){if(!e.orgs.some(s=>s.id===t.orgId))return;let n=Ee(t.role)?t.role:"member",a={id:ae("mem"),orgId:t.orgId,name:t.name.trim().slice(0,80)||"member",role:n,createdAt:Date.now()};return t.email?.trim()&&(a.email=t.email.trim()),t.openId?.trim()&&(a.openId=t.openId.trim()),t.unionId?.trim()&&(a.unionId=t.unionId.trim()),e.members.push(a),a}function Ce(e,t){let n=t.email?.trim().toLowerCase();if(n){let a=e.members.find(s=>s.id&&s.email?.trim().toLowerCase()===n);if(a)return a}if(t.openId){let a=e.members.find(s=>s.id&&s.openId===t.openId);if(a)return a}if(t.unionId)return e.members.find(a=>a.id&&a.unionId===t.unionId)}function de(e,t){let n=e.members.find(u=>u.id===t.memberId);if(!n)return;let a=ot(),s=t.channels.filter(u=>typeof u.channelId=="string"&&u.channelId.trim().length>0).slice(0,rt).map(u=>({channelId:u.channelId.trim().slice(0,64),role:Ee(u.role)?u.role:n.role})),i=t.ttlMs===void 0?it:t.ttlMs,m={id:ae("dev"),memberId:n.id,name:t.name.trim().slice(0,80)||"device",platform:(t.platform??"unknown").slice(0,20),tokenHash:Se(a),grants:s,createdAt:Date.now(),...i>0?{expiresAt:Date.now()+i}:{}};return e.devices.push(m),{device:m,token:a}}function Te(e,t){let n=e.devices.find(a=>a.id===t);return!n||n.revokedAt?!1:(n.revokedAt=Date.now(),!0)}function Y(e,t,n=Date.now()){if(!t.startsWith("pct_"))return;let a=Se(t),s=e.devices.find(i=>xe(i.tokenHash,a));return s||e.devices.find(i=>i.previousTokenHash&&i.previousValidUntil!==void 0&&n<i.previousValidUntil&&xe(i.previousTokenHash,a))}function _e(e,t,n,a,s=Date.now()){let i=Y(e,t,s);if(!i)return{ok:!1,reason:"\u8BBE\u5907\u4EE4\u724C\u65E0\u6548"};if(i.revokedAt)return{ok:!1,device:i,reason:"\u8BBE\u5907\u5DF2\u88AB\u540A\u9500"};if(i.expiresAt!==void 0&&s>i.expiresAt)return{ok:!1,device:i,reason:"\u8BBE\u5907\u4EE4\u724C\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u8BB0\u8BBE\u5907"};let m=e.members.find(p=>p.id===i.memberId);if(!m)return{ok:!1,device:i,reason:"\u8BBE\u5907\u6240\u5C5E\u6210\u5458\u5DF2\u4E0D\u5B58\u5728"};let u=i.grants.find(p=>p.channelId===n);return u?Ie(u.role,a)?(i.lastSeenAt=Date.now(),{ok:!0,device:i,member:m}):{ok:!1,device:i,member:m,reason:`\u89D2\u8272 ${u.role} \u4E0D\u80FD\u6267\u884C ${a}`}:{ok:!1,device:i,member:m,reason:"\u8FD9\u53F0\u8BBE\u5907\u6CA1\u6709\u8BE5\u9891\u9053\u7684\u6388\u6743"}}function Oe(e,t,n,a){let s=e.members.find(y=>y.id===t);if(!s)return{ok:!1,reason:"\u6210\u5458\u4E0D\u5B58\u5728"};let i=e.devices.filter(y=>!y.revokedAt),m=i.filter(y=>y.memberId===t).flatMap(y=>y.grants).find(y=>y.channelId===n),u=m?.role??s.role;return(m?!0:i.some(y=>y.grants.some(C=>C.channelId===n)&&e.members.find(C=>C.id===y.memberId)?.orgId===s.orgId))?Ie(u,a)?{ok:!0,member:s}:{ok:!1,member:s,reason:`\u89D2\u8272 ${u} \u4E0D\u80FD\u6267\u884C ${a}`}:{ok:!1,member:s,reason:"\u8FD9\u4E2A\u9891\u9053\u4E0D\u5C5E\u4E8E\u4F60\u6240\u5728\u7684\u7EC4\u7EC7"}}async function Pe(e,t){await(0,N.mkdir)((0,ke.dirname)(e),{recursive:!0}).catch(()=>{});let n=`${e}.tmp`;await(0,N.writeFile)(n,`${JSON.stringify(t,null,2)}
`,"utf8"),await(0,N.rename)(n,e)}async function De(e){try{let t=await(0,N.readFile)(e,"utf8"),n=JSON.parse(t);return n.version!==oe||!Array.isArray(n.orgs)||!Array.isArray(n.members)||!Array.isArray(n.devices)?void 0:{version:oe,orgs:n.orgs,members:n.members,devices:n.devices}}catch{return}}function Le(e){return{version:e.version,orgs:e.orgs,members:e.members,devices:e.devices.map(t=>({id:t.id,memberId:t.memberId,name:t.name,platform:t.platform,grants:t.grants,createdAt:t.createdAt,lastSeenAt:t.lastSeenAt,revokedAt:t.revokedAt}))}}var Q=require("node:crypto"),Re={authorize:"https://accounts.feishu.cn/open-apis/authen/v1/authorize",token:"https://open.feishu.cn/open-apis/authen/v2/oauth/token",userinfo:"https://open.feishu.cn/open-apis/authen/v1/user_info"};function le(e){return e.toString("base64url")}function Z(e,t){return le((0,Q.createHmac)("sha256",e).update(t,"utf8").digest())}function Me(e,t){let n=Buffer.from(e,"utf8"),a=Buffer.from(t,"utf8");return n.length===a.length&&(0,Q.timingSafeEqual)(n,a)}function He(e,t){let n={...Re,...e.endpoints},a=new URL(n.authorize);return a.searchParams.set("client_id",e.appId),a.searchParams.set("app_id",e.appId),a.searchParams.set("redirect_uri",e.redirectUri),a.searchParams.set("response_type","code"),a.searchParams.set("state",t),a.toString()}function $e(e,t,n=10*6e4){let a=`${t}.${Date.now()+n}`;return`${le(Buffer.from(a,"utf8"))}.${Z(e,a)}`}function Ne(e,t){if(!t)return!1;let n=t.lastIndexOf(".");if(n<=0)return!1;let a=t.slice(0,n),s=t.slice(n+1),i;try{i=Buffer.from(a,"base64url").toString("utf8")}catch{return!1}if(!Me(Z(e,i),s))return!1;let m=Number(i.slice(i.lastIndexOf(".")+1));return Number.isFinite(m)&&m>Date.now()}function Be(e,t){let n=le(Buffer.from(JSON.stringify(t),"utf8"));return`${n}.${Z(e,n)}`}function ce(e,t){if(!t)return;let n=t.lastIndexOf(".");if(n<=0)return;let a=t.slice(0,n),s=t.slice(n+1);if(Me(Z(e,a),s))try{let i=JSON.parse(Buffer.from(a,"base64url").toString("utf8"));return!i.memberId||typeof i.exp!="number"||i.exp<=Date.now()?void 0:i}catch{return}}function X(e){if(!e||typeof e!="object")return{};let t=e,n=t.data;return n&&typeof n=="object"?n:t}function T(e){return typeof e=="string"&&e.trim()?e.trim():void 0}async function Ue(e,t,n=fetch){let a={...Re,...e.endpoints},s=[{grant_type:"authorization_code",client_id:e.appId,client_secret:e.appSecret,code:t,redirect_uri:e.redirectUri},{grant_type:"authorization_code",app_id:e.appId,app_secret:e.appSecret,code:t}],i="\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE access_token";for(let m of s)try{let u=await n(a.token,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(m)}),p=await u.json().catch(()=>{}),y=T(X(p).access_token);if(!u.ok||!y){i=T(X(p).error_description)??T(X(p).msg)??`HTTP ${u.status}`;continue}let P=await(await n(a.userinfo,{headers:{authorization:`Bearer ${y}`}})).json().catch(()=>{}),h=X(P),L=T(h.name)??T(h.en_name);if(!L){i="\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE\u7528\u6237\u59D3\u540D";continue}return{ok:!0,identity:{name:L,...T(h.email)??T(h.enterprise_email)?{email:T(h.email)??T(h.enterprise_email)}:{},...T(h.open_id)?{openId:T(h.open_id)}:{},...T(h.union_id)?{unionId:T(h.union_id)}:{}}}}catch(u){i=u instanceof Error?u.message:String(u)}return{ok:!1,error:i}}function je(e,t){if(!t.length)return!0;if(!e)return!1;let n=e.lastIndexOf("@");if(n<0)return!1;let a=e.slice(n+1).toLowerCase();return t.some(s=>s.trim().toLowerCase().replace(/^@/,"")===a)}var st="1",dt=96*1024,lt=9e4;function ze(e){return(0,F.createHash)("sha256").update(e,"utf8").digest("hex")}function l(e,t,n,a={}){let s=JSON.stringify(n);e.writeHead(t,{"content-type":"application/json; charset=utf-8","content-length":Buffer.byteLength(s),"cache-control":"no-store","x-content-type-options":"nosniff",...a}),e.end(s)}function G(e){return new Promise(t=>{let n=[],a=0;e.on("data",s=>{if(a+=s.length,a>dt){t(void 0),e.destroy();return}n.push(s)}),e.on("end",()=>t(Buffer.concat(n).toString("utf8"))),e.on("error",()=>t(void 0))})}function z(e){let t=e.headers.authorization??"";return/^Bearer\s+(.+)$/i.exec(t.trim())?.[1]?.trim()??""}function E(e){let t=e.headers["x-real-ip"];if(typeof t=="string"&&t.trim())return t.trim();let n=e.headers["x-forwarded-for"];return typeof n=="string"&&n.trim()?n.split(",")[0].trim():(e.socket.remoteAddress??"").replace(/^::ffff:/,"")}async function Ke(e={}){let t=Math.max(20,e.maxMessages??500),n=Math.max(1e3,Math.min(e.maxWaitMs??22e3,25e3)),a=Math.max(10,e.rateLimit??240),s=e.log??(()=>{}),i=new W(e.audit),m=new Map,u=new Map,p=fe(e.historyDir,t),y=(r,o)=>(r.ready||(r.ready=p.load(o).then(x=>{if(!x.length)return;let b=new Set(r.messages.map(S=>S.id));for(let S of x)b.has(S.id)||(r.messages.push({seq:S.seq,id:S.id,from:S.from,envelope:{iv:S.iv,ct:S.ct},at:S.at}),r.seen.add(S.id),S.seq>r.seq&&(r.seq=S.seq));r.messages.sort((S,B)=>S.seq-B.seq),r.messages.length>t&&(r.messages=r.messages.slice(-t)),s(`[relay] \u9891\u9053 ${o.slice(0,8)}\u2026 \u4ECE\u78C1\u76D8\u6062\u590D ${x.length} \u6761\uFF0Cseq=${r.seq}`)}).catch(()=>{})),r.ready),C=(r,o)=>{let x=m.get(r);if(x)return x.keyHash===ze(o)?x:void 0;if(!/^[0-9a-f]{16,64}$/.test(r))return;let b={keyHash:ze(o),createdAt:Date.now(),seq:0,messages:[],waiters:[],seen:new Set,presence:new Map};return m.set(r,b),y(b,r),s(`[relay] \u65B0\u9891\u9053 ${r.slice(0,8)}\u2026`),b},P=r=>{let o=Date.now(),x=u.get(r);return!x||o>=x.resetAt?(u.set(r,{count:1,resetAt:o+6e4}),!0):(x.count+=1,x.count<=a)},h=e.identity,L=e.adminToken??"",K=r=>{if(!/^[0-9a-f]{16,64}$/.test(r))return;let o=m.get(r);if(o)return o;let x={keyHash:"",createdAt:Date.now(),seq:0,messages:[],waiters:[],seen:new Set,presence:new Map};return m.set(r,x),y(x,r),s(`[relay] \u65B0\u9891\u9053 ${r.slice(0,8)}\u2026\uFF08\u8EAB\u4EFD\u6A21\u5F0F\uFF09`),x},j=(r,o,x)=>{if(!h)return{ok:!0};let b=z(r);if(b){let J=_e(h.state,b,o,x);return J.ok?{ok:!0,deviceId:J.device?.id,member:J.member?.name}:{ok:!1,status:403,reason:J.reason??"\u672A\u6388\u6743"}}let S=e.auth;if(!S)return{ok:!1,status:403,reason:"\u8BBE\u5907\u4EE4\u724C\u65E0\u6548"};let B=ce(S.secret,ie(r.headers.cookie).plaitcode_session);if(!B)return{ok:!1,status:401,reason:"\u672A\u767B\u5F55\uFF1A\u8BF7\u5148\u7528\u98DE\u4E66\u767B\u5F55"};let V=Oe(h.state,B.memberId,o,x);return V.ok?{ok:!0,member:V.member?.name}:{ok:!1,status:403,reason:V.reason??"\u672A\u6388\u6743"}},O=async()=>{h?.path&&await Pe(h.path,h.state).catch(r=>{s(`[relay] \u8EAB\u4EFD\u5E93\u5199\u5165\u5931\u8D25\uFF1A${r instanceof Error?r.message:String(r)}`)})},q=r=>{if(!L||typeof r!="string")return!1;let o=(0,F.createHash)("sha256").update(r).digest(),x=(0,F.createHash)("sha256").update(L).digest();return o.length===x.length&&(0,F.timingSafeEqual)(o,x)},H=(0,Fe.createServer)((r,o)=>{(async()=>{let x=r.url??"/",b=x.split("?")[0]??"/",S=new URLSearchParams(x.slice(x.indexOf("?")+1)),B=b==="/health"||b==="/";if(!(B||(b==="/manifest.webmanifest"||b==="/sw.js"||b==="/icon.svg")||b==="/m")){let v=E(r);if(!P(v)){i.record({event:"denied",ip:v,detail:"rate limited"}),l(o,429,{ok:!1,error:"too many requests"});return}}if(r.method==="GET"&&b==="/m"){let v=be({relayHost:typeof r.headers.host=="string"?r.headers.host:"plaitcode.com",sessionAuth:!!h});o.writeHead(200,{"content-type":"text/html; charset=utf-8","content-length":Buffer.byteLength(v),"cache-control":"no-store","x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"no-referrer"}),o.end(v);return}if(r.method==="GET"&&b==="/manifest.webmanifest"){let v=ye();o.writeHead(200,{"content-type":"application/manifest+json; charset=utf-8","content-length":Buffer.byteLength(v),"cache-control":"public, max-age=3600","x-content-type-options":"nosniff"}),o.end(v);return}if(r.method==="GET"&&b==="/sw.js"){o.writeHead(200,{"content-type":"application/javascript; charset=utf-8","content-length":Buffer.byteLength(re),"cache-control":"no-cache","service-worker-allowed":"/","x-content-type-options":"nosniff"}),o.end(re);return}if(r.method==="GET"&&b==="/icon.svg"){o.writeHead(200,{"content-type":"image/svg+xml; charset=utf-8","content-length":Buffer.byteLength(ne),"cache-control":"public, max-age=86400","x-content-type-options":"nosniff"}),o.end(ne);return}if(b==="/v1/auth/feishu/start"&&r.method==="GET"){let v=e.auth;if(!v||!h){l(o,404,{ok:!1,error:"sso disabled"});return}let c=$e(v.secret,crypto.randomUUID());o.writeHead(302,{location:He(v.config,c),"cache-control":"no-store"}),o.end();return}if(b==="/v1/auth/feishu/callback"&&r.method==="GET"){let v=e.auth;if(!v||!h){l(o,404,{ok:!1,error:"sso disabled"});return}if(!Ne(v.secret,S.get("state")??void 0)){i.record({event:"denied",ip:E(r),detail:"sso state invalid"}),l(o,400,{ok:!1,error:"state \u65E0\u6548\u6216\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55"});return}let c=S.get("code")??"";if(!c){l(o,400,{ok:!1,error:"\u7F3A\u5C11 code"});return}let d=await Ue(v.config,c);if(!d.ok){i.record({event:"denied",ip:E(r),detail:`sso exchange failed: ${d.error}`}),l(o,502,{ok:!1,error:`\u98DE\u4E66\u767B\u5F55\u5931\u8D25\uFF1A${d.error}`});return}if(v.emailDomains?.length&&!d.identity.email){i.record({event:"denied",ip:E(r),detail:"sso email missing while domain allowlist configured"}),l(o,403,{ok:!1,error:"\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE\u90AE\u7BB1\uFF0C\u65E0\u6CD5\u6821\u9A8C\u57DF\u540D\u767D\u540D\u5355\u3002\u8BF7\u7ED9\u5E94\u7528\u5F00\u901A contact:user.email:readonly \u6743\u9650\u5E76\u53D1\u5E03\u7248\u672C\uFF0C\u6216\u628A PLAITCODE_AUTH_EMAIL_DOMAINS \u6E05\u7A7A\u3002"});return}if(!je(d.identity.email,v.emailDomains??[])){i.record({event:"denied",ip:E(r),detail:`sso email not allowed: ${d.identity.email??"(none)"}`}),l(o,403,{ok:!1,error:"\u8FD9\u4E2A\u90AE\u7BB1\u4E0D\u5728\u5141\u8BB8\u7684\u57DF\u540D\u5185"});return}let f=d.identity,g=Ce(h.state,f);if(!g&&(f.email||f.openId||f.unionId)){let I=h.state.orgs[0];if(!I){l(o,409,{ok:!1,error:"\u670D\u52A1\u7AEF\u8FD8\u6CA1\u6709\u7EC4\u7EC7\uFF0C\u8BF7\u7BA1\u7406\u5458\u5148\u5EFA\u7EC4\u7EC7"});return}g=se(h.state,{orgId:I.id,name:f.name,role:"member",email:f.email,openId:f.openId,unionId:f.unionId}),g&&(await O(),i.record({event:"admin",ip:E(r),detail:`auto-provision ${f.email??f.openId??f.unionId}`}))}if(!g){i.record({event:"denied",ip:E(r),detail:"sso identity has no stable key"}),l(o,409,{ok:!1,error:"\u65E0\u6CD5\u5EFA\u7ACB\u6210\u5458\u8EAB\u4EFD\uFF1A\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE\u53EF\u7528\u4E8E\u8BC6\u522B\u8EAB\u4EFD\u7684\u6807\u8BC6\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458"});return}f.email&&!g.email&&(g.email=f.email,await O());let A=v.sessionTtlMs??720*6e4,w=Be(v.secret,{memberId:g.id,name:g.name,...d.identity.email?{email:d.identity.email}:{},exp:Date.now()+A});i.record({event:"login",ip:E(r),detail:g.name}),o.writeHead(302,{location:"/m","set-cookie":`plaitcode_session=${w}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(A/1e3)}`,"cache-control":"no-store"}),o.end();return}if(b==="/v1/auth/me"&&r.method==="GET"){let v=e.auth;if(!v){l(o,404,{ok:!1,error:"sso disabled"});return}let c=ce(v.secret,ie(r.headers.cookie).plaitcode_session);if(!c){l(o,401,{ok:!1,error:"\u672A\u767B\u5F55"});return}l(o,200,{ok:!0,member:{id:c.memberId,name:c.name,email:c.email??null}});return}if(b==="/v1/auth/logout"&&r.method==="POST"){o.writeHead(200,{"content-type":"application/json; charset=utf-8","set-cookie":"plaitcode_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"}),o.end(JSON.stringify({ok:!0}));return}if(b==="/v1/devices/enroll"&&r.method==="POST"){if(!h){l(o,404,{ok:!1,error:"identity disabled"});return}if(e.selfEnroll===!1){l(o,403,{ok:!1,error:"self enrollment disabled"});return}let v=z(r),c=v?Y(h.state,v):void 0,d=c&&!c.revokedAt&&(c.expiresAt===void 0||Date.now()<=c.expiresAt)?c:void 0;if(!d){i.record({event:"denied",ip:E(r),detail:"enroll auth failed"}),l(o,403,{ok:!1,error:"\u9700\u8981\u7528\u5DF2\u767B\u8BB0\u7684\u8BBE\u5907\u4EE4\u724C\u8C03\u7528"});return}let f=await G(r);if(f===void 0){l(o,413,{ok:!1,error:"body too large"});return}let g={};if(f)try{g=JSON.parse(f)}catch{l(o,400,{ok:!1,error:"invalid json"});return}let A=de(h.state,{memberId:d.memberId,name:String(g.name??"\u65B0\u8BBE\u5907"),platform:typeof g.platform=="string"?g.platform:void 0,channels:d.grants.map(w=>({channelId:w.channelId,role:w.role}))});if(!A){l(o,409,{ok:!1,error:"\u6210\u5458\u4E0D\u5B58\u5728"});return}await O(),i.record({event:"admin",ip:E(r),detail:`self-enroll ${A.device.name}`}),l(o,200,{ok:!0,device:{id:A.device.id,name:A.device.name,grants:A.device.grants},token:A.token});return}if(b==="/v1/notify"&&r.method==="POST"){let v=e.notifyHook?.trim();if(!v){l(o,404,{ok:!1,error:"notify disabled"});return}let c=z(r),d=h&&c?Y(h.state,c):void 0;if(h&&(!d||d.revokedAt)){i.record({event:"denied",ip:E(r),detail:"notify auth failed"}),l(o,403,{ok:!1,error:"\u9700\u8981\u7528\u5DF2\u767B\u8BB0\u7684\u8BBE\u5907\u4EE4\u724C\u8C03\u7528"});return}let f=await G(r);if(f===void 0){l(o,413,{ok:!1,error:"body too large"});return}let g={};try{g=f?JSON.parse(f):{}}catch{l(o,400,{ok:!1,error:"invalid json"});return}let A=g.kind==="approval"||g.kind==="done"||g.kind==="blocked"?g.kind:void 0;if(!A){l(o,400,{ok:!1,error:"kind must be approval/done/blocked"});return}let w={kind:A,title:String(g.title??"").slice(0,120),summary:String(g.summary??"").slice(0,500),...typeof g.source=="string"?{source:g.source.slice(0,120)}:{}},I=e.auth?.config?.redirectUri?(()=>{try{return new URL(e.auth.config.redirectUri).origin}catch{return""}})():"",k=await me(v,w,I?`${I}/m`:"");i.record({event:"admin",ip:E(r),detail:`notify ${A} -> ${k.ok?"sent":`failed: ${k.error}`}`}),l(o,k.ok?200:502,k.ok?{ok:!0}:{ok:!1,error:k.error});return}if(b.startsWith("/v1/admin/")){if(!h||!L){l(o,404,{ok:!1,error:"admin api disabled"});return}if(!q(r.headers["x-plaitcode-admin"])){i.record({event:"denied",ip:E(r),detail:"admin auth failed"}),l(o,403,{ok:!1,error:"admin denied"});return}let v=r.method==="POST"?await G(r):"";if(v===void 0){l(o,413,{ok:!1,error:"body too large"});return}let c={};if(v)try{c=JSON.parse(v)}catch{l(o,400,{ok:!1,error:"invalid json"});return}if(b==="/v1/admin/state"&&r.method==="GET"){l(o,200,{ok:!0,identity:Le(h.state)});return}if(b==="/v1/admin/orgs"&&r.method==="POST"){let d=Ae(h.state,String(c.name??""));await O(),i.record({event:"admin",ip:E(r),detail:`org ${d.name}`}),l(o,200,{ok:!0,org:d});return}if(b==="/v1/admin/members"&&r.method==="POST"){let d=se(h.state,{orgId:String(c.orgId??""),name:String(c.name??""),role:c.role});if(!d){l(o,404,{ok:!1,error:"org not found"});return}await O(),i.record({event:"admin",ip:E(r),detail:`member ${d.name} (${d.role})`}),l(o,200,{ok:!0,member:d});return}if(b==="/v1/admin/devices"&&r.method==="POST"){let d=Array.isArray(c.channels)?c.channels:[],f=de(h.state,{memberId:String(c.memberId??""),name:String(c.name??""),platform:typeof c.platform=="string"?c.platform:void 0,channels:d.filter(g=>!!g&&typeof g=="object").map(g=>({channelId:String(g.channelId??""),role:g.role}))});if(!f){l(o,404,{ok:!1,error:"member not found"});return}await O(),i.record({event:"admin",ip:E(r),detail:`device ${f.device.name} for ${f.device.memberId}`}),l(o,200,{ok:!0,device:{id:f.device.id,memberId:f.device.memberId,name:f.device.name,grants:f.device.grants},token:f.token});return}if(b==="/v1/admin/devices/revoke"&&r.method==="POST"){let d=Te(h.state,String(c.deviceId??""));await O(),i.record({event:"admin",ip:E(r),detail:`revoke ${String(c.deviceId??"")} -> ${d}`}),l(o,d?200:404,{ok:d});return}l(o,404,{ok:!1,error:"not found"});return}if(r.method==="GET"&&B){l(o,200,{ok:!0,service:"plaitcode-relay",version:st,channels:m.size,uptime:Math.round(process.uptime())});return}if(!b.startsWith("/v1/")){l(o,404,{ok:!1,error:"not found"});return}if(r.method==="GET"&&b==="/v1/poll"){let v=S.get("channel")??"",c=j(r,v,"poll");if(!c.ok){i.record({event:"denied",channel:v.slice(0,32),ip:E(r),detail:c.reason}),l(o,c.status,{ok:!1,error:c.reason});return}let d=h?K(v):C(v,z(r));if(!d){l(o,403,{ok:!1,error:"channel denied"});return}d.ready&&await d.ready;let f=Number(S.get("since")??0)||0,g=Math.min(Math.max(Number(S.get("wait")??20)*1e3||2e4,0),n),A=()=>d.messages.filter(M=>M.seq>f),w=A();if(w.length||g===0){l(o,200,{ok:!0,messages:w.slice(-200),seq:d.seq});return}let I=!1,k=()=>{if(I)return;I=!0;let M=d.waiters.indexOf(k);M>=0&&d.waiters.splice(M,1),clearTimeout(R),!o.writableEnded&&l(o,200,{ok:!0,messages:A().slice(-200),seq:d.seq})},R=setTimeout(k,g);R.unref?.(),d.waiters.push(k),r.on("close",()=>{if(I)return;I=!0;let M=d.waiters.indexOf(k);M>=0&&d.waiters.splice(M,1),clearTimeout(R)});return}if(r.method==="POST"&&b==="/v1/publish"){let v=await G(r);if(!v){l(o,413,{ok:!1,error:"body too large"});return}let c;try{c=JSON.parse(v)}catch{l(o,400,{ok:!1,error:"invalid json"});return}let d=typeof c.channel=="string"?c.channel:"",f=typeof c.id=="string"?c.id.slice(0,80):"",g=typeof c.from=="string"?c.from.slice(0,80):"",A=typeof c.envelope?.iv=="string"?c.envelope.iv:"",w=typeof c.envelope?.ct=="string"?c.envelope.ct:"";if(!f||!g||!A||!w||w.length>64*1024){l(o,400,{ok:!1,error:"invalid message"});return}let I=j(r,d,"publish");if(!I.ok){i.record({event:"denied",channel:d.slice(0,32),ip:E(r),detail:I.reason}),l(o,I.status,{ok:!1,error:I.reason});return}let k=h?K(d):C(d,z(r));if(!k){i.record({event:"denied",channel:d.slice(0,32),ip:E(r),detail:"channel denied"}),l(o,403,{ok:!1,error:"channel denied"});return}if(k.ready&&await k.ready,k.seen.has(f)){i.record({event:"publish",channel:d,device:g,message:f,ip:E(r),detail:"duplicate"}),l(o,200,{ok:!0,duplicate:!0,seq:k.seq});return}k.seq+=1,k.seen.add(f),i.record({event:"publish",channel:d,device:g,message:f,ip:E(r),bytes:w.length}),k.seen.size>t*4&&(k.seen=new Set([...k.seen].slice(-t*2)));let R={seq:k.seq,id:f,from:g,envelope:{iv:A,ct:w},at:Date.now()};k.messages.push(R),p.append(d,{seq:R.seq,id:R.id,from:R.from,iv:A,ct:w,at:R.at}),k.messages.length>t&&(k.messages=k.messages.slice(-t));for(let M of[...k.waiters])M();l(o,200,{ok:!0,seq:k.seq});return}if(b==="/v1/presence"){let v=z(r),c=S.get("channel")??"",d;if(r.method==="POST"){let w=await G(r);if(!w){l(o,413,{ok:!1,error:"body too large"});return}let I;try{I=JSON.parse(w)}catch{l(o,400,{ok:!1,error:"invalid json"});return}c=typeof I.channel=="string"?I.channel:"",d=I.device}let f=j(r,c,"presence");if(!f.ok){i.record({event:"denied",channel:c.slice(0,32),ip:E(r),detail:f.reason}),l(o,f.status,{ok:!1,error:f.reason});return}let g=h?K(c):C(c,v);if(!g){l(o,403,{ok:!1,error:"channel denied"});return}if(d){let w=f.deviceId??(typeof d.id=="string"?d.id.slice(0,80):"");if(!w){l(o,400,{ok:!1,error:"invalid device"});return}g.presence.set(w,{name:f.member?`${f.member} \xB7 ${typeof d.name=="string"?d.name.slice(0,60):"\u8BBE\u5907"}`:typeof d.name=="string"?d.name.slice(0,120):w,platform:typeof d.platform=="string"?d.platform:"unknown",project:typeof d.project=="string"?d.project.slice(0,120):"",at:Date.now()})}let A=Date.now();for(let[w,I]of g.presence)A-I.at>lt&&g.presence.delete(w);l(o,200,{ok:!0,devices:[...g.presence.entries()].map(([w,I])=>({id:w,...I}))});return}l(o,404,{ok:!1,error:"not found"})})().catch(x=>{s(`[relay] \u8BF7\u6C42\u5904\u7406\u5931\u8D25\uFF1A${x instanceof Error?x.message:String(x)}`),o.writableEnded||l(o,500,{ok:!1,error:"internal error"})})});await new Promise((r,o)=>{H.once("error",o),H.listen(e.port??8787,e.host??"0.0.0.0",()=>{H.off("error",o),r()})});let _=H.address(),te=_&&typeof _=="object"?_.port:e.port??8787;return s(`[relay] \u76D1\u542C ${e.host??"0.0.0.0"}:${te}`),i.record({event:"startup",detail:`listen ${e.host??"0.0.0.0"}:${te}`}),{port:te,close:()=>new Promise(r=>{i.record({event:"shutdown"});for(let o of m.values())for(let x of[...o.waiters])x();H.close(()=>{Promise.all([i.flush(),p.flush()]).then(()=>r())}),setTimeout(()=>r(),1500).unref?.()})}}var Ge=require("node:dgram"),qe=require("node:http"),Ve=require("node:https"),We=require("node:net");function Ye(e){let t=(e??"").trim();if(t)try{if(/^otlp\+https?:\/\//i.test(t))return{kind:"otlp",url:new URL(t.replace(/^otlp\+/i,""))};if(/^syslog\+tcp:\/\//i.test(t))return{kind:"syslog-tcp",url:new URL(t.replace(/^syslog\+tcp:/i,"http:"))};if(/^syslog:\/\//i.test(t))return{kind:"syslog",url:new URL(t.replace(/^syslog:/i,"http:"))};if(/^https?:\/\//i.test(t))return{kind:"webhook",url:new URL(t)}}catch{return}}function Je(e,t,n){let a;try{a=e}catch{return}let s=Buffer.from(t,"utf8"),m=(a.protocol==="https:"?Ve.request:qe.request)(a,{method:"POST",headers:{"content-type":"application/json","content-length":String(s.length)},timeout:n},u=>{u.resume()});m.on("timeout",()=>m.destroy()),m.on("error",()=>{}),m.end(s)}function ct(e,t){let n=`${Date.now()}000000`;try{let a=JSON.parse(e);if(typeof a.ts=="string"){let s=Date.parse(a.ts);Number.isFinite(s)&&(n=`${s}000000`)}}catch{}return JSON.stringify({resourceLogs:[{resource:{attributes:[{key:"service.name",value:{stringValue:"plaitcode-relay"}},{key:"host.name",value:{stringValue:t}}]},scopeLogs:[{scope:{name:"plaitcode.audit"},logRecords:[{timeUnixNano:n,severityText:"INFO",body:{stringValue:e}}]}]}]})}function Xe(e,t={}){let n=t.hostname??"plaitcode-relay";if(e.kind==="webhook")return{send:u=>Je(e.url,u,5e3),close:()=>{}};if(e.kind==="otlp")return{send:u=>Je(e.url,ct(u,n),5e3),close:()=>{}};let a=e.url.hostname,s=Number(e.url.port||514);if(e.kind==="syslog"){let u=(0,Ge.createSocket)("udp4");return u.on("error",()=>{}),u.unref?.(),{send:p=>{let y=`<14>1 - ${n} plaitcode-relay - AUDIT - ${p}`;try{u.send(Buffer.from(y,"utf8"),s,a,()=>{})}catch{}},close:()=>{try{u.close()}catch{}}}}let i,m=()=>(i&&!i.destroyed||(i=(0,We.connect)(s,a,()=>{}),i.on("error",()=>{i=void 0}),i.on("close",()=>{i=void 0}),i.unref?.()),i);return{send:u=>{let p=m();if(p)try{p.write(`<14>1 - ${n} plaitcode-relay - AUDIT - ${u}
`)}catch{i=void 0}},close:()=>{try{i?.destroy()}catch{}}}}var Qe=require("node:os"),ee=require("node:path");async function ut(){let e=Number(process.env.PLAITCODE_PORT??8787),t=process.env.PLAITCODE_HOST??"127.0.0.1",n=process.env.PLAITCODE_AUDIT??"/var/lib/plaitcode-relay/audit.jsonl",a=process.env.PLAITCODE_AUDIT_STDOUT!=="0",s=process.env.PLAITCODE_IDENTITY?.trim(),i=process.env.PLAITCODE_ADMIN_TOKEN?.trim()??"",m=process.env.PLAITCODE_HISTORY?.trim(),u=m==="-"?void 0:m||(n!=="-"?(0,ee.join)((0,ee.dirname)(n),"channels"):"/var/lib/plaitcode-relay/channels"),p=s?{state:await De(s)??we(),path:s}:void 0;p&&(console.log(`[relay] \u8EAB\u4EFD\u6A21\u5F0F\uFF1A${p.state.orgs.length} \u7EC4\u7EC7 / ${p.state.members.length} \u6210\u5458 / ${p.state.devices.length} \u8BBE\u5907`),i||console.log("[relay] \u8B66\u544A\uFF1A\u6CA1\u8BBE PLAITCODE_ADMIN_TOKEN\uFF0C\u7BA1\u7406\u63A5\u53E3\u4E0D\u53EF\u7528"));let y=Ye(process.env.PLAITCODE_AUDIT_SINK),C=y?Xe(y,{hostname:(0,Qe.hostname)()}):void 0;y&&console.log(`[relay] \u5BA1\u8BA1\u5916\u9001\uFF1A${y.kind} \u2192 ${y.url.host}`);let P=process.env.PLAITCODE_FEISHU_APP_ID?.trim()??"",h=process.env.PLAITCODE_FEISHU_APP_SECRET?.trim()??"",L=process.env.PLAITCODE_AUTH_SECRET?.trim()??"",K=(process.env.PLAITCODE_PUBLIC_URL?.trim()||"https://plaitcode.com").replace(/\/+$/,""),j=P&&h?{appId:P,appSecret:h,redirectUri:`${K}/v1/auth/feishu/callback`,...process.env.PLAITCODE_FEISHU_AUTHORIZE?{endpoints:{authorize:process.env.PLAITCODE_FEISHU_AUTHORIZE}}:{},...process.env.PLAITCODE_FEISHU_TOKEN?{endpoints:{token:process.env.PLAITCODE_FEISHU_TOKEN}}:{},...process.env.PLAITCODE_FEISHU_USERINFO?{endpoints:{userinfo:process.env.PLAITCODE_FEISHU_USERINFO}}:{}}:void 0,O=j&&L&&p?{config:j,secret:L,emailDomains:(process.env.PLAITCODE_AUTH_EMAIL_DOMAINS??"").split(",").map(_=>_.trim()).filter(Boolean)}:void 0;O?console.log("[relay] \u98DE\u4E66\u767B\u5F55\u5DF2\u542F\u7528"):P&&console.log("[relay] \u8B66\u544A\uFF1A\u98DE\u4E66\u767B\u5F55\u9700\u8981 PLAITCODE_AUTH_SECRET \u4E0E\u8EAB\u4EFD\u5E93\uFF08PLAITCODE_IDENTITY\uFF09"),process.env.PLAITCODE_FEISHU_WEBHOOK?.trim()&&console.log("[relay] \u98DE\u4E66\u673A\u5668\u4EBA\u901A\u77E5\u5DF2\u542F\u7528");let q=await Ke({port:Number.isFinite(e)&&e>0?e:8787,host:t,log:_=>console.log(_),...p?{identity:p}:{},...i?{adminToken:i}:{},...O?{auth:O}:{},...u?{historyDir:u}:{},...process.env.PLAITCODE_SELF_ENROLL==="0"?{selfEnroll:!1}:{},...process.env.PLAITCODE_FEISHU_WEBHOOK?.trim()?{notifyHook:process.env.PLAITCODE_FEISHU_WEBHOOK.trim()}:{},audit:{...n&&n!=="-"?{path:n}:{},sink:(_=>{a&&console.log(`[audit] ${_}`),C?.send(_)}),includeIp:process.env.PLAITCODE_AUDIT_IP!=="0",maxBytes:Number(process.env.PLAITCODE_AUDIT_MAX_BYTES??20*1024*1024),keep:Number(process.env.PLAITCODE_AUDIT_KEEP??5)}});console.log(`[relay] ready on http://${t}:${q.port}`);let H=_=>{console.log(`[relay] ${_}\uFF0C\u6B63\u5728\u5173\u95ED`),C?.close(),q.close().then(()=>process.exit(0))};process.on("SIGTERM",()=>H("SIGTERM")),process.on("SIGINT",()=>H("SIGINT"))}ut().catch(e=>{console.error(`[relay] \u542F\u52A8\u5931\u8D25\uFF1A${e instanceof Error?e.message:String(e)}`),process.exit(1)});
