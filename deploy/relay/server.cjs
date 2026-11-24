"use strict";var H=require("node:crypto"),bt=require("node:http");var R=require("node:fs/promises"),De=require("node:path"),se=class{constructor(e={}){this.options=e;this.maxBytes=Math.max(4*1024,e.maxBytes??20*1024*1024),this.keep=Math.max(1,Math.min(e.keep??3,20)),this.includeIp=e.includeIp??!0}options;maxBytes;keep;includeIp;queue=Promise.resolve();written=0;record(e){let n={ts:(this.options.now?.()??new Date).toISOString(),event:e.event,...e.channel?{channel:e.channel}:{},...e.device?{device:e.device}:{},...e.message?{message:e.message}:{},...e.ip&&this.includeIp?{ip:e.ip}:{},...typeof e.bytes=="number"?{bytes:e.bytes}:{},...e.detail?{detail:e.detail}:{}},a=`${JSON.stringify(n)}
`;try{this.options.sink?.(a.trimEnd())}catch{}let p=this.options.path;p&&(this.queue=this.queue.then(()=>this.append(p,a)).catch(()=>{}))}async flush(){await this.queue.catch(()=>{})}async tail(e=200){let n=this.options.path;if(!n)return[];await this.flush();let a;try{a=await(0,R.readFile)(n,"utf8")}catch{return[]}let p=a.split(`
`).filter(h=>h.trim()),o=Math.max(1,Math.min(Math.floor(e),1e3)),b=[];for(let h of p.slice(-o))try{let v=JSON.parse(h);v&&typeof v=="object"&&b.push(v)}catch{}return b.reverse()}async append(e,n){let a=Buffer.byteLength(n);this.written===0&&(this.written=await(0,R.stat)(e).then(p=>p.size).catch(()=>0)),this.written+a>this.maxBytes&&(await this.rotate(e),this.written=0),await(0,R.mkdir)((0,De.dirname)(e),{recursive:!0}).catch(()=>{}),await(0,R.appendFile)(e,n,"utf8"),this.written+=a}async rotate(e){for(let n=this.keep;n>=1;n-=1){let a=n===1?e:`${e}.${n-1}`,p=`${e}.${n}`;await(0,R.rename)(a,p).catch(()=>{})}}};var N=require("node:fs/promises"),Le=require("node:path"),Ot=/^[0-9a-f]{16,64}$/;function Re(t,e=500){if(!t)return{load:async()=>[],append:()=>{},flush:async()=>{}};let n=new Map,a=o=>Ot.test(o)?(0,Le.join)(t,`${o}.jsonl`):void 0,p=o=>{let b=[];for(let h of o.split(`
`))if(h.trim())try{let v=JSON.parse(h);if(typeof v.seq!="number"||!Number.isFinite(v.seq)||typeof v.id!="string"||!v.id||typeof v.iv!="string"||typeof v.ct!="string")continue;b.push({seq:v.seq,id:v.id,from:typeof v.from=="string"?v.from:"",iv:v.iv,ct:v.ct,at:typeof v.at=="number"&&Number.isFinite(v.at)?v.at:0})}catch{}return b.sort((h,v)=>h.seq-v.seq)};return{async load(o){let b=a(o);if(!b)return[];let h;try{h=await(0,N.readFile)(b,"utf8")}catch{return[]}let v=p(h),k=e>0?v.slice(-e):v;if(v.length>k.length*2&&k.length>0){let T=k.map(m=>JSON.stringify(m)).join(`
`),A=`${b}.tmp`;await(0,N.writeFile)(A,`${T}
`,"utf8").catch(()=>{}),await(0,N.rename)(A,b).catch(()=>{})}return k},append(o,b){let h=a(o);if(!h)return;let v=`${JSON.stringify(b)}
`,T=(n.get(o)??Promise.resolve()).then(async()=>{await(0,N.mkdir)(t,{recursive:!0}).catch(()=>{}),await(0,N.appendFile)(h,v,"utf8")}).catch(()=>{});n.set(o,T),T.then(()=>{n.get(o)===T&&n.delete(o)})},async flush(){await Promise.all([...n.values()])}}}var $t={approval:"\u9700\u8981\u4F60\u6279\u51C6",done:"\u4EFB\u52A1\u5B8C\u6210",blocked:"\u672A\u6267\u884C"},Mt={approval:"\u23F3",done:"\u2705",blocked:"\u26A0\uFE0F"};function Ht(t,e){return[`${Mt[t.kind]} PlaitCode \xB7 ${$t[t.kind]}`,t.title?`\u4E8B\u9879\uFF1A${t.title}`:"",t.summary?`\u8BE6\u60C5\uFF1A${t.summary}`:"",t.source?`\u6765\u81EA\uFF1A${t.source}`:"",e?`\u6253\u5F00\uFF1A${e}`:""].filter(Boolean).join(`
`)}async function Ne(t,e,n,a=5e3){if(!/^https:\/\//i.test(t))return{ok:!1,error:"webhook \u5FC5\u987B\u662F https \u5730\u5740"};try{let p=await fetch(t,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({msg_type:"text",content:{text:Ht(e,n)}}),signal:AbortSignal.timeout(a)});if(!p.ok)return{ok:!1,error:`HTTP ${p.status}`};let o=await p.json().catch(()=>{}),b=o?.code??o?.StatusCode??0;return b!==0?{ok:!1,error:o?.msg??`code ${b}`}:{ok:!0}}catch(p){return{ok:!1,error:p instanceof Error?p.message:String(p)}}}var ze="plaitcode/channel/1:",Be="plaitcode/relay/1:",Ue="plaitcode/enc/1:";function je(t){let e=t.relayHost.replace(/[<>&"]/g,""),n=t.sessionAuth===!0,a=(t.loginPath??"/v1/auth/feishu/start").replace(/[^A-Za-z0-9/?=&._-]/g,""),p=(t.loginLabel??"\u98DE\u4E66").replace(/[<>&"']/g,"");return`<!doctype html>
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
  <span class="meta" id="meta">${e}</span>
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
    return Promise.all([digest('${ze}'), digest('${Be}'), digest('${Ue}')])
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
   * \u672A\u767B\u5F55 \u2192 \u8DF3\u767B\u5F55\u9875\uFF08GitHub \u6216\u98DE\u4E66\uFF0C\u7531\u670D\u52A1\u7AEF\u51B3\u5B9A\uFF09\u3002
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
    say('\u9700\u8981\u5148\u7528${p}\u767B\u5F55\uFF0C\u6B63\u5728\u8DF3\u8F6C\u2026');
    try { sessionStorage.setItem('plaitcode.loginRedirect', '1'); } catch (error) {}
    setTimeout(function () { location.replace('${a}'); }, 400);
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
          throw new Error(SESSION_AUTH ? '\u767B\u5F55\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55' : '\u9700\u8981\u767B\u5F55\u624D\u80FD\u770B\u8FD9\u4E2A\u9891\u9053');
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
</html>`}function K(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}var we=`
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
  a.card { display:block; color:var(--text); transition:border-color .16s ease-out; }
  a.card:hover { border-color:var(--line-strong); text-decoration:none; }
  a.card:hover h3 { color:var(--accent); }
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
`,Dt={terminal:'<path d="M4 5h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/><path d="m6 9 2 2-2 2M10 13h4"/>',phone:'<rect x="6.5" y="3" width="7" height="14" rx="1.6"/><path d="M9 15h2"/>',shield:'<path d="M10 3 4.5 5v4.5c0 3.2 2.2 6.1 5.5 7 3.3-.9 5.5-3.8 5.5-7V5L10 3Z"/><path d="m7.6 9.8 1.7 1.7 3.1-3.2"/>',users:'<circle cx="7.5" cy="8" r="2.2"/><path d="M3.8 15.5c.4-2 1.9-3.2 3.7-3.2s3.3 1.2 3.7 3.2"/><path d="M13 6.3a2 2 0 0 1 0 3.7M14 12.6c1.4.2 2.4 1.3 2.7 2.9"/>',board:'<rect x="3.5" y="4" width="4.2" height="12" rx="1"/><rect x="8.8" y="4" width="4.2" height="8" rx="1"/><rect x="14.1" y="4" width="2.4" height="10" rx="1"/>',key:'<circle cx="7" cy="10" r="3"/><path d="M10 10h7M15 10v3M17.5 10v2"/>',server:'<rect x="3.5" y="4" width="13" height="5" rx="1.3"/><rect x="3.5" y="11" width="13" height="5" rx="1.3"/><path d="M6 6.5h.01M6 13.5h.01"/>',activity:'<path d="M3 11h3l2-5 3.5 9 2-4h3.5"/>',message:'<path d="M3.5 5.5h13v7.5h-7.2L5.6 16v-3H3.5Z"/>',question:'<circle cx="10" cy="10" r="6.5"/><path d="M8.1 8.1a1.9 1.9 0 1 1 2.7 1.7c-.5.3-.8.7-.8 1.3v.2M10 14h.01"/>',check:'<path d="m4.4 10.6 3.6 3.6 7.6-8.2"/>',laptop:'<rect x="4.6" y="4.5" width="10.8" height="7.4" rx="1.2"/><path d="M2.9 14.8h14.2"/>'};function z(t,e="icon"){return`<svg class="${e}" viewBox="0 0 20 20" aria-hidden="true">${Dt[t]??""}</svg>`}function Fe(t){let e=K(t.relayHost),n=K(t.installUrl),a=K(t.repoUrl),p=[["\u88C5\u6269\u5C55","\u5728 VS Code \u91CC\u88C5 PlaitCode\uFF0C\u6216\u7528 VSIX \u79BB\u7EBF\u5B89\u88C5\u3002"],["\u767B\u5F55\u4E00\u6B21","\u547D\u4EE4\u9762\u677F\u6267\u884C\u300C\u5F00\u59CB\u534F\u4F5C\u300D\uFF0C\u6D4F\u89C8\u5668\u91CC\u7528 GitHub \u6388\u6743\u3002\u4E0D\u586B\u5730\u5740\u3001\u4E0D\u8981\u914D\u5BF9\u7801\u3002"],["\u5F00\u59CB\u7528","\u7B2C\u4E8C\u53F0\u7535\u8111\u6267\u884C\u540C\u4E00\u4E2A\u547D\u4EE4\uFF1B\u624B\u673A\u626B\u4E00\u6B21\u7801\u3002\u90FD\u5728\u540C\u4E00\u6761\u9891\u9053\u91CC\u3002"]],o=[["message","\u5148\u8BF4\u5B83\u542C\u61C2\u4E86\u4EC0\u4E48","\u628A\u4F60\u8981\u7684\u6548\u679C\u590D\u8FF0\u4E00\u904D\uFF1A\u54EA\u4E2A\u754C\u9762\u3001\u770B\u5230\u4EC0\u4E48\u3001\u4EC0\u4E48\u7B97\u505A\u5B8C\u3002\u4E0D\u51FA\u73B0\u6587\u4EF6\u540D\u548C\u53D8\u91CF\u540D\u3002"],["question","\u542B\u7CCA\u5C31\u95EE\u4F60","\u62FF\u4E0D\u51C6\u7684\u5730\u65B9\u7ED9\u4E8C\u9009\u4E00\uFF0C\u4F60\u53EA\u8981\u6311\u4E00\u4E2A\uFF1B\u6CA1\u7B54\u5B8C\u5B83\u4E0D\u5F00\u59CB\u6539\u3002"],["check","\u505A\u5B8C\u544A\u8BC9\u4F60\u600E\u4E48\u9A8C","\u7528\u5927\u767D\u8BDD\u8BB2\u6539\u4E86\u4EC0\u4E48\uFF0C\u4EE5\u53CA\u4F60\u81EA\u5DF1\u70B9\u4E24\u4E0B\u5C31\u80FD\u786E\u8BA4\u7684\u6B65\u9AA4\u3002"]],b=[["terminal","\u591A\u8BBE\u5907\u4E0E\u624B\u673A","\u4E09\u6B65\u4E0A\u624B\u3001\u7535\u6E90\u8BBE\u7F6E\u3001\u6392\u67E5\u8868\u3001\u5B89\u5168\u8FB9\u754C\u3002",`${a}/blob/main/docs/COLLAB-SETUP.md`],["users","\u5B83\u548C\u522B\u7684\u5DE5\u5177\u600E\u4E48\u5206\u5DE5","PR\u3001Live Share\u3001Cursor \u5404\u81EA\u64C5\u957F\u4EC0\u4E48\uFF0C\u8FD9\u91CC\u8865\u7684\u662F\u54EA\u4E00\u6BB5\u3002",`${a}/blob/main/docs/WEBSITE.md`],["shield","\u4F01\u4E1A\u80FD\u529B","\u7EC4\u7EC7\u4E0E\u89D2\u8272\u3001\u5BA1\u8BA1\u3001\u7B56\u7565\u4E0B\u53D1\u3001\u79C1\u6709\u5316\u90E8\u7F72\u3002",`${a}/blob/main/docs/ENTERPRISE.md`],["server","\u67B6\u6784\u8BF4\u660E","\u4F20\u8F93\u3001\u8EAB\u4EFD\u3001\u534F\u4F5C\u8BED\u4E49\u4E09\u5C42\u4E3A\u4EC0\u4E48\u5206\u5F00\u3002",`${a}/blob/main/docs/ARCHITECTURE-REVIEW.md`]];return`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0f1115">
<meta name="description" content="PlaitCode\uFF1A\u4E0D\u4F1A\u5199\u4EE3\u7801\u4E5F\u80FD\u628A\u60F3\u6CD5\u505A\u51FA\u6765\u3002\u7528\u4E2D\u6587\u63D0\u9700\u6C42\uFF0CAI \u5148\u590D\u8FF0\u3001\u518D\u8FFD\u95EE\u3001\u786E\u8BA4\u540E\u624D\u52A8\u624B\uFF0C\u4EA4\u4ED8\u65F6\u544A\u8BC9\u4F60\u81EA\u5DF1\u600E\u4E48\u9A8C\u3002">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: 'self'; connect-src 'self'; manifest-src 'self'">
<title>PlaitCode \xB7 \u4F60\u8BF4\u8981\u4EC0\u4E48\uFF0C\u5B83\u5148\u95EE\u6E05\u695A\u518D\u52A8\u624B</title>
<style>${we}
  .hero { padding:var(--s7) 0 var(--s8); position:relative; }
  .hero::before { content:""; position:absolute; inset:-40% 20% auto; height:420px; pointer-events:none;
    background:radial-gradient(ellipse at 50% 0%, rgba(76,154,255,.16), transparent 68%); }
  .hero .wrap { position:relative; }
  .hero-grid { display:grid; gap:var(--s7); grid-template-columns:minmax(0,1fr) minmax(0,1.05fr); align-items:center; }
  .hero h1 { margin:0 0 var(--s4); font-size:var(--fs-hero); line-height:1.15; letter-spacing:-1px; font-weight:600; }
  .hero .lede { font-size:var(--fs-h3); line-height:1.6; color:var(--text-2); max-width:32em; }
  .hero .actions { display:flex; gap:var(--s3); flex-wrap:wrap; margin-top:var(--s6); align-items:center; }
  .hero .fine { margin-top:var(--s3); color:var(--text-3); font-size:var(--fs-xs); }
  @media (max-width:960px) { .hero-grid { grid-template-columns:1fr; } .hero h1 { font-size:32px; } }

  /* \u4EA7\u54C1\u793A\u610F\u56FE\uFF1A\u7528\u771F\u5B9E\u7ED3\u6784\u753B\uFF0C\u4E0D\u653E\u4F1A\u8FC7\u65F6\u7684\u622A\u56FE */
  .window { border:1px solid var(--line-strong); border-radius:var(--r-lg); background:var(--surface); overflow:hidden; }
  .window-bar { display:flex; align-items:center; gap:var(--s2); height:36px; padding:0 var(--s3);
    border-bottom:1px solid var(--line); color:var(--text-3); font-size:var(--fs-xs); }
  .window-bar .dots { display:flex; gap:var(--s1); }
  .window-bar .dots i { width:8px; height:8px; border-radius:50%; background:var(--line-strong); display:block; }
  .window-body { padding:var(--s4); display:grid; gap:var(--s3); }
  .msg { display:flex; flex-direction:column; gap:var(--s1); max-width:92%; }
  .msg .who { font-size:var(--fs-xs); color:var(--text-3); display:flex; align-items:center; gap:var(--s2); flex-wrap:wrap; }
  .msg .bubble { border:1px solid var(--line); background:var(--surface-2); border-radius:var(--r-md);
    padding:var(--s2) var(--s3); font-size:var(--fs-sm); line-height:1.55; }
  .msg .bubble p + p { margin-top:var(--s2); }
  .msg.mine { align-self:flex-end; }
  .msg.mine .bubble { background:rgba(76,154,255,.14); border-color:rgba(76,154,255,.35); }

  .steps { display:grid; gap:var(--s4); grid-template-columns:repeat(3, minmax(0,1fr)); }
  .step { border-top:1px solid var(--line-strong); padding-top:var(--s4); }
  .step .n { color:var(--text-3); font-size:var(--fs-xs); font-variant-numeric:tabular-nums; }
  .step h3 { margin-top:var(--s2); font-size:var(--fs-h3); font-weight:600; }
  .step p { margin-top:var(--s1); color:var(--text-2); font-size:var(--fs-sm); }
  @media (max-width:840px) { .steps { grid-template-columns:1fr; } }

  .quote { border-left:2px solid var(--accent); padding:var(--s1) 0 var(--s1) var(--s4);
    color:var(--text-2); font-size:var(--fs-sm); }
  .quote b { color:var(--text); }
  .quote cite { display:block; margin-top:var(--s2); color:var(--text-3); font-size:var(--fs-xs); font-style:normal; }
  .note-line { display:flex; gap:var(--s2); align-items:center; margin-top:var(--s5); padding:var(--s3) var(--s4);
    border:1px solid var(--line); border-radius:var(--r-md); background:var(--surface);
    color:var(--text-2); font-size:var(--fs-sm); }
  .note-line .icon { color:var(--accent); }

  /* \u5B89\u88C5\u547D\u4EE4\uFF1A\u4E00\u884C\u80FD\u590D\u5236\uFF0C\u4E0D\u89E3\u91CA\u591A\u4F59\u7684\u4E1C\u897F */
  .install { margin-top:var(--s6); border:1px solid var(--line); border-radius:var(--r-lg);
    background:var(--surface); overflow:hidden; }
  .install-head { display:flex; align-items:center; gap:var(--s3); padding:var(--s2) var(--s3) var(--s2) var(--s4);
    border-bottom:1px solid var(--line); color:var(--text-2); font-size:var(--fs-xs); }
  .install-head button { margin-left:auto; min-height:28px; padding:0 var(--s2); font-size:var(--fs-xs); }
  .install pre { margin:0; padding:var(--s4); overflow-x:auto; color:var(--text); }
  .install pre code { font-size:var(--fs-sm); }
  .install-foot { display:flex; gap:var(--s2) var(--s4); flex-wrap:wrap; align-items:center;
    padding:var(--s3) var(--s4); border-top:1px solid var(--line); color:var(--text-3); font-size:var(--fs-xs); }
  .install-foot a { color:var(--accent); }
  .install-foot code { color:var(--text-2); }

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
      <a href="#start">\u600E\u4E48\u5F00\u59CB</a>
      <a href="#ask">\u4E3A\u4EC0\u4E48\u8FD9\u4E48\u7528</a>
      <a href="#deeper">\u6587\u6863</a>
    </nav>
    <div class="nav-actions">
      <a class="btn btn-ghost" href="/console">\u63A7\u5236\u53F0</a>
      <a class="btn btn-primary" href="${n}">\u5B89\u88C5</a>
    </div>
  </div>
</header>

<main id="main">
  <div class="hero">
    <div class="wrap">
      <div class="hero-grid">
        <div>
          <h1>\u4F60\u8BF4\u8981\u4EC0\u4E48\uFF0C<br>\u5B83\u5148\u95EE\u6E05\u695A\uFF0C\u518D\u52A8\u624B\u3002</h1>
          <p class="lede">\u4F60\u4E0D\u9700\u8981\u4F1A\u5199\u4EE3\u7801\u3002\u7528\u4E2D\u6587\u628A\u60F3\u6CD5\u8BF4\u51FA\u6765\uFF0C\u5B83\u5148\u590D\u8FF0\u4E00\u904D\u3001\u628A\u542B\u7CCA\u7684\u5730\u65B9\u95EE\u660E\u767D\uFF0C\u7B49\u4F60\u70B9\u5934\u624D\u5F00\u59CB\u6539\u3002</p>
          <div class="actions">
            <a class="btn btn-primary btn-lg" href="${n}">\u5728 VS Code \u5B89\u88C5</a>
            <a class="btn btn-lg" href="/m">\u624B\u673A\u7AEF \u2192</a>
          </div>
          <p class="fine">\u9700\u8981\u4E00\u4E2A GitHub \u8D26\u53F7\uFF1F<a href="https://github.com/signup" target="_blank" rel="noopener">\u514D\u8D39\u6CE8\u518C \u2192</a></p>
        </div>

        <div class="window" role="img" aria-label="\u5BF9\u8BDD\u793A\u610F\uFF1A\u7528\u6237\u63D0\u4E00\u53E5\u8BDD\u9700\u6C42\uFF0CAI \u590D\u8FF0\u7406\u89E3\u5E76\u8FFD\u95EE\u4E24\u5904\u542B\u7CCA\u7684\u5730\u65B9\uFF0C\u7528\u6237\u56DE\u7B54\u540E\u786E\u8BA4\u6267\u884C">
          <div class="window-bar"><span class="dots"><i></i><i></i><i></i></span>\u56E2\u961F\u7FA4</div>
          <div class="window-body">
            <div class="msg mine">
              <span class="who">\u4F60</span>
              <span class="bubble">\u4F1A\u5458\u5FEB\u5230\u671F\u7684\u65F6\u5019\u8981\u80FD\u63D0\u9192\u7528\u6237\u7EED\u8D39\uFF0C\u4E0D\u7136\u4ED6\u4EEC\u5C31\u76F4\u63A5\u4E0D\u7528\u4E86\u3002</span>
            </div>
            <div class="msg">
              <span class="who">AI <span class="tag tag-warn"><span class="dot"></span>\u7B49\u4F60\u56DE\u590D</span></span>
              <span class="bubble"><p>\u6211\u7406\u89E3\u6210\uFF1A\u5230\u671F\u524D 7 \u5929\uFF0C\u5728 App \u91CC\u63D0\u793A\u4E00\u6B21\uFF0C\u5E76\u7ED9\u4E00\u4E2A\u7EED\u8D39\u6309\u94AE\u3002</p><p>\u8FD8\u6709\u4E24\u5904\u8981\u4F60\u5B9A\uFF1A\u2460 \u53EA\u5728 App \u91CC\u63D0\u793A\uFF0C\u8FD8\u662F\u4E5F\u53D1\u77ED\u4FE1\uFF1F\u2461 \u5230\u671F\u4E4B\u540E\u8FD8\u80FD\u4E0D\u80FD\u770B\u4EE5\u524D\u7684\u5185\u5BB9\uFF1F</p></span>
            </div>
            <div class="msg mine">
              <span class="who">\u4F60</span>
              <span class="bubble">\u53EA\u5728 App \u91CC\u63D0\u793A\u3002\u5230\u671F\u540E\u8FD8\u80FD\u770B\uFF0C\u4F46\u4E0D\u80FD\u65B0\u589E\u3002</span>
            </div>
            <div class="msg">
              <span class="who">AI <span class="tag tag-ok"><span class="dot"></span>\u5DF2\u786E\u8BA4</span></span>
              <span class="bubble">\u6309\u8FD9\u4E2A\u6765\uFF1A\u5230\u671F\u524D 7 \u5929\u63D0\u793A + \u7EED\u8D39\u6309\u94AE\uFF0C\u5230\u671F\u540E\u53EA\u8BFB\u3002\u505A\u5B8C\u544A\u8BC9\u4F60\u600E\u4E48\u9A8C\u3002</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <section class="section" id="start">
    <div class="wrap">
      <div class="section-head">
        <div class="eyebrow">\u600E\u4E48\u5F00\u59CB</div>
        <h2>\u4E09\u6B65\uFF0C\u7136\u540E\u53EA\u8BF4\u4EBA\u8BDD</h2>
      </div>
      <div class="steps">
        ${p.map(([h,v],k)=>`<div class="step"><div class="n">0${k+1}</div><h3>${h}</h3><p>${v}</p></div>`).join("")}
      </div>

      <div class="install">
        <div class="install-head">
          <span>\u5728\u7EC8\u7AEF\u91CC\u88C5\uFF08macOS / Windows / Linux \u4E00\u6837\uFF09</span>
          <button class="btn btn-ghost" type="button" id="copyInstall" data-command="code --install-extension plaitcode.plaitcode">\u590D\u5236</button>
        </div>
        <pre><code id="installCommand">code --install-extension plaitcode.plaitcode</code></pre>
        <div class="install-foot">
          <span>\u627E\u4E0D\u5230 <code>code</code> \u547D\u4EE4\uFF1F\u5728 VS Code \u91CC <code>Ctrl+Shift+P</code> \u6267\u884C <code>Shell Command: Install 'code' command in PATH</code>\u3002</span>
          <a href="${a}/releases/latest">\u6216\u4E0B\u8F7D .vsix \u79BB\u7EBF\u5B89\u88C5 \u2192</a>
        </div>
      </div>
    </div>
  </section>

  <section class="section" id="ask">
    <div class="wrap">
      <div class="section-head">
        <div class="eyebrow">\u4E3A\u4EC0\u4E48\u8FD9\u4E48\u7528</div>
        <h2>\u5148\u628A\u9700\u6C42\u95EE\u6E05\u695A\uFF0C\u662F\u6B63\u89C4\u534F\u4F5C\u7684\u62C6\u6CD5</h2>
        <p class="lede">\u884C\u4E1A\u91CC\u628A\u4E00\u6761\u9700\u6C42\u62C6\u6210\u4E09\u6BB5\uFF0C\u8FD9\u91CC\u53EA\u662F\u628A\u8FD9\u4E09\u6BB5\u56FA\u5B9A\u5728\u6D41\u7A0B\u91CC\uFF0C\u8BA9\u5B83\u4E0D\u80FD\u88AB\u8DF3\u8FC7\u3002</p>
      </div>
      <div class="grid-3">
        ${o.map(([h,v,k])=>`<div class="card"><h3>${z(h)}${v}</h3><p>${k}</p></div>`).join("")}
      </div>
      <div class="quote" style="margin-top:var(--s6)">
        \u9700\u6C42\u5361 Card \u2192 \u6F84\u6E05\u5BF9\u8BDD Conversation \u2192 \u9A8C\u6536\u6807\u51C6 Confirmation\u3002\u9700\u6C42\u7528\u975E\u6280\u672F\u8BED\u8A00\u5199\uFF0C\u7EC6\u8282\u5728\u53CC\u65B9\u786E\u8BA4\u4E4B\u540E\u624D\u8865\u3002
        <cite>Atlassian\u300AUser stories with examples and a template\u300B</cite>
      </div>
    </div>
  </section>

  <section class="section" id="deeper">
    <div class="wrap">
      <div class="section-head">
        <div class="eyebrow">\u60F3\u6DF1\u5165\u7684\u65F6\u5019</div>
        <h2>\u8FD9\u4E9B\u4E0D\u7528\u8BFB\u4E5F\u80FD\u7528</h2>
        <p class="lede">\u4E0B\u9762\u6BCF\u4E00\u6761\u90FD\u662F\u7ED9\u60F3\u77E5\u9053\u7EC6\u8282\u7684\u4EBA\u51C6\u5907\u7684\u3002</p>
      </div>
      <div class="grid-3">
        ${b.map(([h,v,k,T])=>`<a class="card" href="${K(T)}"><h3>${z(h)}${v}</h3><p>${k}</p></a>`).join("")}
      </div>
      <div class="note-line">
        ${z("key","icon icon-sm")}
        <span>\u534F\u4F5C\u5185\u5BB9\u7AEF\u5230\u7AEF\u52A0\u5BC6\uFF1A\u670D\u52A1\u5668\u53EA\u8F6C\u53D1\u5BC6\u6587\uFF0C\u89E3\u4E0D\u5F00\u4F60\u7684\u6D88\u606F\u3002\u670D\u52A1\u7AEF ${e}</span>
      </div>
      ${t.consoleEnabled?"":`<div class="banner">${z("shield","icon icon-sm")}<span>\u8FD9\u53F0\u670D\u52A1\u5668\u8FD8\u6CA1\u5F00\u653E\u767B\u5F55\uFF0C\u63A7\u5236\u53F0\u6682\u65F6\u6253\u4E0D\u5F00\u3002</span></div>`}
    </div>
  </section>

  <div class="cta-band">
    <div class="wrap inner">
      <div>
        <h2>\u73B0\u5728\u5C31\u53EF\u4EE5\u8BD5</h2>
        <p>\u88C5\u597D\u3001\u767B\u5F55\u4E00\u6B21\uFF0C\u5C31\u80FD\u5F00\u59CB\u3002</p>
      </div>
      <div class="actions">
        <a class="btn btn-primary btn-lg" href="${n}">\u5B89\u88C5\u6269\u5C55</a>
        <a class="btn btn-lg" href="/m">\u624B\u673A\u7AEF</a>
      </div>
    </div>
  </div>
</main>

<footer class="site">
  <div class="wrap">
    <div class="foot-bottom" style="margin-top:0;border-top:0;padding-top:0">
      <span>\xA9 2026 PlaitCode</span>
      <span><a href="${a}">GitHub</a></span>
      <span><a href="${a}/tree/main/docs">\u5168\u90E8\u6587\u6863</a></span>
      <span style="margin-left:auto">\u53EA\u8F6C\u53D1\u5BC6\u6587 \xB7 \u4E0D\u5B58\u4EE3\u7801</span>
    </div>
  </div>
</footer>
<script>
(function () {
  var button = document.getElementById('copyInstall');
  var command = document.getElementById('installCommand');
  if (!button || !command) return;
  var label = button.textContent;
  button.addEventListener('click', function () {
    var text = button.getAttribute('data-command') || command.textContent || '';
    var done = function () {
      button.textContent = '\u5DF2\u590D\u5236';
      setTimeout(function () { button.textContent = label; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
      return;
    }
    fallback(text, done);
  });
  // \u975E https \u6216\u65E7\u6D4F\u89C8\u5668\u6CA1\u6709 clipboard API \u65F6\uFF0C\u9000\u56DE\u5230\u9009\u4E2D\u6587\u672C
  function fallback(text, done) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); done(); } catch (error) { button.textContent = '\u8BF7\u624B\u52A8\u9009\u4E2D\u590D\u5236'; }
    document.body.removeChild(area);
  }
})();
</script>
</body>
</html>`}function Ie(t){let e=t.ok?"var(--ok)":"var(--bad)";return`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0f1115">
<title>${K(t.title)} \xB7 PlaitCode</title>
<style>${we}
  .stage { min-height:100vh; display:grid; place-items:center; padding:var(--s5); }
  .card { max-width:420px; width:100%; border:1px solid var(--line); border-radius:var(--r-lg);
    background:var(--surface); padding:var(--s6); text-align:center; }
  .mark { width:48px; height:48px; margin:0 auto var(--s4); border-radius:50%;
    display:grid; place-items:center; border:1px solid ${e}; color:${e}; }
  h1 { font-size:var(--fs-h2); font-weight:600; }
  p { margin-top:var(--s2); color:var(--text-2); font-size:var(--fs-sm); line-height:1.7; }
</style>
</head>
<body>
<div class="stage">
  <div class="card">
    <div class="mark">${t.ok?z("check"):z("question")}</div>
    <h1>${K(t.title)}</h1>
    <p>${K(t.body)}</p>
  </div>
</div>
</body>
</html>`}function Ge(t){let e=K(t.relayHost),n=t.sessionAuth?"true":"false";return`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0f1115">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: 'self'; connect-src 'self'; manifest-src 'self'">
<title>PlaitCode \u63A7\u5236\u53F0</title>
<style>${we}
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
      <div><b>PlaitCode \u63A7\u5236\u53F0</b><span>${e}</span></div>
    </div>
    <nav aria-label="\u63A7\u5236\u53F0\u5BFC\u822A" id="tabs">
      <a href="#overview" data-tab="overview" aria-current="page">${z("activity","icon icon-sm")}\u6982\u89C8</a>
      <a href="#devices" data-tab="devices">${z("terminal","icon icon-sm")}\u8BBE\u5907</a>
      <a href="#channels" data-tab="channels">${z("board","icon icon-sm")}\u901A\u9053</a>
      <a href="#audit" data-tab="audit">${z("shield","icon icon-sm")}\u5BA1\u8BA1</a>
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
  var sessionAuth = ${n};
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
    var invite = el('button', 'btn', '\u600E\u4E48\u52A0\u5165\u65B0\u8BBE\u5907');
    invite.addEventListener('click', function () {
      alert('\u5728\u5DF2\u6388\u6743\u7684\u8BBE\u5907\u4E0A\u6267\u884C\uFF1A\\n\\nPlaitCode: \u7ED9\u53E6\u4E00\u53F0\u8BBE\u5907\u53D1\u914D\u5BF9\u4FE1\u606F\uFF08\u542B\u8BBE\u5907\u4EE4\u724C\uFF09\\n\\n\u628A\u590D\u5236\u51FA\u6765\u7684\u90A3\u4E00\u884C\u7C98\u5230\u65B0\u8BBE\u5907\u7684\u300C\u52A0\u5165\u8DE8\u7F51\u9891\u9053\u300D\u5373\u53EF\u3002\u63A7\u5236\u53F0\u4E0D\u53D1\u4EE4\u724C \u2014\u2014 \u9891\u9053\u5BC6\u94A5\u53EA\u5B58\u5728\u4F60\u7684\u8BBE\u5907\u4E0A\u3002');
    });
    view.appendChild(pageHead('\u8BBE\u5907', '\u6BCF\u53F0\u8BBE\u5907\u4E00\u6761\u8BB0\u5F55\uFF08Windows \u7248\u3001macOS \u7248\u5404\u4E00\u6761\uFF09\u3002\u6362\u673A\u5668\u65F6\u5148\u5728\u8FD9\u91CC\u540A\u9500\u65E7\u7684\uFF0C\u518D\u8BA9\u65B0\u8BBE\u5907\u63A5\u5165\u3002', [invite]));

    var list = panel('\u8BBE\u5907', data.devices.length);
    if (!data.devices.length) {
      list.body.appendChild(emptyState('terminal', '\u8FD8\u6CA1\u6709\u8BBE\u5907',
        '\u5728 VS Code \u91CC\u6267\u884C\u300CPlaitCode: \u65B0\u5EFA\u8DE8\u7F51\u9891\u9053\u300D\uFF0C\u8FD9\u53F0\u8BBE\u5907\u4F1A\u81EA\u52A8\u767B\u8BB0\u8FDB\u6765\u3002'));
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
</html>`}var Je=require("node:crypto"),Ke="23456789ABCDEFGHJKLMNPQRSTUVWXYZ",de=class{entries=new Map;ttlMs;maxPending;now;constructor(e={}){this.ttlMs=Math.max(6e4,e.ttlMs??10*6e4),this.maxPending=Math.max(8,e.maxPending??200),this.now=e.now??Date.now}newCode(){let e=(0,Je.randomBytes)(8),n="";for(let a of e)n+=Ke[a%Ke.length];return`${n.slice(0,4)}-${n.slice(4,8)}`}start(e={}){if(this.sweep(),this.entries.size>=this.maxPending){let a=[...this.entries.values()].sort((p,o)=>p.createdAt-o.createdAt)[0];a&&this.entries.delete(a.code)}let n=this.newCode();return this.entries.set(n,{code:n,createdAt:this.now(),deviceName:(e.deviceName??"VS Code").slice(0,80),platform:(e.platform??"unknown").slice(0,20)}),{code:n,expiresIn:Math.round(this.ttlMs/1e3)}}peek(e){let n=this.entries.get(Ve(e));if(n){if(this.now()-n.createdAt>this.ttlMs){this.entries.delete(n.code);return}return n}}bind(e,n){let a=this.peek(e);return!a||a.result?!1:(a.result=n,!0)}poll(e){let n=this.entries.get(Ve(e));return n?this.now()-n.createdAt>this.ttlMs?(this.entries.delete(n.code),{status:"expired"}):n.result?(this.entries.delete(n.code),{status:"ready",result:n.result}):{status:"pending",deviceName:n.deviceName}:{status:"expired"}}sweep(){let e=this.now();for(let[n,a]of this.entries)e-a.createdAt>this.ttlMs&&this.entries.delete(n)}get size(){return this.entries.size}};function Ve(t){let e=t.trim().toUpperCase().replace(/[^0-9A-Z]/g,"");return e.length===8?`${e.slice(0,4)}-${e.slice(4)}`:e}var le=class{slots=new Map;ttlMs;maxBytes;now;constructor(e={}){this.ttlMs=Math.max(6e4,e.ttlMs??30*6e4),this.maxBytes=Math.max(1024,e.maxBytes??32*1024),this.now=e.now??Date.now}put(e){return typeof e.iv!="string"||typeof e.ct!="string"?{ok:!1,error:"invalid envelope"}:Buffer.byteLength(e.iv)+Buffer.byteLength(e.ct)>this.maxBytes?{ok:!1,error:"envelope too large"}:(this.slots.set(e.toDeviceId,{...e,at:this.now()}),{ok:!0})}take(e){this.sweep();let n=this.slots.get(e);if(n)return this.slots.delete(e),n}has(e){return this.sweep(),this.slots.has(e)}sweep(){let e=this.now();for(let[n,a]of this.slots)e-a.at>this.ttlMs&&this.slots.delete(n)}get size(){return this.slots.size}};var Lt="https://github.com/login/oauth/authorize",Rt="https://github.com/login/oauth/access_token",Nt="https://api.github.com",zt="read:user";function We(t,e){let n=new URL(t.authorizeUrl??Lt);return n.searchParams.set("client_id",t.clientId),n.searchParams.set("redirect_uri",t.redirectUri),n.searchParams.set("scope",zt),n.searchParams.set("state",e),n.searchParams.set("allow_signup","true"),n.toString()}function q(t){return typeof t=="string"&&t.trim()?t.trim():void 0}async function Ye(t,e,n=fetch){let a=(t.apiBase??Nt).replace(/\/+$/,""),p;try{let A=await n(t.tokenUrl??Rt,{method:"POST",headers:{"content-type":"application/json",accept:"application/json","user-agent":"PlaitCode-Relay"},body:JSON.stringify({client_id:t.clientId,client_secret:t.clientSecret,code:e,redirect_uri:t.redirectUri})}),m=await A.json().catch(()=>{});if(p=q(m?.access_token),!A.ok||!p)return{ok:!1,error:q(m?.error_description)??q(m?.error)??`HTTP ${A.status}`}}catch(A){return{ok:!1,error:A instanceof Error?A.message:String(A)}}let o={authorization:`Bearer ${p}`,accept:"application/vnd.github+json","user-agent":"PlaitCode-Relay","x-github-api-version":"2022-11-28"},b;try{let A=await n(`${a}/user`,{headers:o});if(!A.ok)return{ok:!1,error:`\u8BFB\u53D6 GitHub \u7528\u6237\u5931\u8D25\uFF1AHTTP ${A.status}`};b=await A.json()}catch(A){return{ok:!1,error:A instanceof Error?A.message:String(A)}}let h=b.id,v=q(b.login),k=typeof h=="number"?String(h):q(h);if(!k||!v)return{ok:!1,error:"GitHub \u6CA1\u6709\u8FD4\u56DE\u7528\u6237 id \u6216\u767B\u5F55\u540D"};let T=q(b.email);return{ok:!0,identity:{githubId:k,login:v,name:q(b.name)??v,...T?{email:T}:{}}}}var Se=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="PlaitCode">
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
</svg>`;function Ze(){return JSON.stringify({name:"PlaitCode \xB7 \u56E2\u961F\u7FA4",short_name:"PlaitCode",description:"\u5728\u624B\u673A\u4E0A\u6307\u6325\u7535\u8111\u4E0A\u7684\u7F16\u7801 agent\uFF1A\u63D0\u9700\u6C42\u3001\u770B\u8FDB\u5EA6\u3001\u6279\u51C6\u64CD\u4F5C\u3002",start_url:"/m",scope:"/",display:"standalone",orientation:"portrait",background_color:"#0f1115",theme_color:"#0f1115",lang:"zh-CN",icons:[{src:"/icon.svg",sizes:"any",type:"image/svg+xml",purpose:"any"},{src:"/icon.svg",sizes:"any",type:"image/svg+xml",purpose:"maskable"}]},null,2)}var Ce=`/* PlaitCode PWA service worker */
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
`;var an=10*6e4,on=720*6e4;var sn=5*6e4;function ce(t){let e={};for(let n of(t??"").split(";")){let a=n.indexOf("=");if(a<=0)continue;let p=n.slice(0,a).trim();p&&(e[p]=decodeURIComponent(n.slice(a+1).trim()))}return e}var ee=require("node:crypto"),V=require("node:fs/promises"),Qe=require("node:path"),Ee=1,qe=100,Bt=0,ln=1440*6e4;function et(){return{version:Ee,orgs:[],members:[],devices:[]}}function Ae(t){return`${t}_${(0,ee.randomBytes)(9).toString("base64url")}`}function Ut(){return`pct_${(0,ee.randomBytes)(24).toString("base64url")}`}function tt(t){return(0,ee.createHash)("sha256").update(t,"utf8").digest("hex")}function Xe(t,e){let n=Buffer.from(t,"utf8"),a=Buffer.from(e,"utf8");return n.length===a.length&&(0,ee.timingSafeEqual)(n,a)}var jt={viewer:["poll","presence"],member:["publish","poll","presence"],admin:["publish","poll","presence","manage"],owner:["publish","poll","presence","manage"]};function pe(t,e){return(jt[t]??[]).includes(e)}function nt(t){return t==="owner"||t==="admin"||t==="member"||t==="viewer"}function Te(t,e){let n={id:Ae("org"),name:e.trim().slice(0,80)||"org",createdAt:Date.now()};return t.orgs.push(n),n}function ue(t,e){if(!t.orgs.some(p=>p.id===e.orgId))return;let n=nt(e.role)?e.role:"member",a={id:Ae("mem"),orgId:e.orgId,name:e.name.trim().slice(0,80)||"member",role:n,createdAt:Date.now()};return e.email?.trim()&&(a.email=e.email.trim()),e.githubId?.trim()&&(a.githubId=e.githubId.trim()),e.githubLogin?.trim()&&(a.githubLogin=e.githubLogin.trim()),e.openId?.trim()&&(a.openId=e.openId.trim()),e.unionId?.trim()&&(a.unionId=e.unionId.trim()),t.members.push(a),a}function Pe(t,e){if(e.githubId){let a=t.members.find(p=>p.id&&p.githubId===e.githubId);if(a)return a}let n=e.email?.trim().toLowerCase();if(n){let a=t.members.find(p=>p.id&&p.email?.trim().toLowerCase()===n);if(a)return a}if(e.openId){let a=t.members.find(p=>p.id&&p.openId===e.openId);if(a)return a}if(e.unionId)return t.members.find(a=>a.id&&a.unionId===e.unionId)}function rt(t,e,n,a=!0){let p=t.devices.find(b=>b.id===e);if(!p||p.revokedAt)return!1;let o=n.trim();return/^[A-Za-z0-9+/=]{40,88}$/.test(o)?(p.pubkey=o,p.needsKey=a,!0):!1}function it(t,e){let n=t.devices.find(a=>a.id===e);return n?(n.needsKey=!1,!0):!1}function at(t,e,n){let a=t.devices.find(o=>o.id===e);if(!a||a.revokedAt||!/^[0-9a-f]{16,64}$/.test(n))return!1;if(a.grants.some(o=>o.channelId===n))return!0;if(a.grants.length>=qe)return!1;let p=t.members.find(o=>o.id===a.memberId);return a.grants.push({channelId:n,role:p?.role??"member"}),!0}function fe(t,e){let n=t.members.find(h=>h.id===e.memberId);if(!n)return;let a=Ut(),p=e.channels.filter(h=>typeof h.channelId=="string"&&h.channelId.trim().length>0).slice(0,qe).map(h=>({channelId:h.channelId.trim().slice(0,64),role:nt(h.role)?h.role:n.role})),o=e.ttlMs===void 0?Bt:e.ttlMs,b={id:Ae("dev"),memberId:n.id,name:e.name.trim().slice(0,80)||"device",platform:(e.platform??"unknown").slice(0,20),tokenHash:tt(a),grants:p,createdAt:Date.now(),...o>0?{expiresAt:Date.now()+o}:{}};return t.devices.push(b),{device:b,token:a}}function _e(t,e){let n=t.devices.find(a=>a.id===e);return!n||n.revokedAt?!1:(n.revokedAt=Date.now(),!0)}function J(t,e,n=Date.now()){if(!e.startsWith("pct_"))return;let a=tt(e),p=t.devices.find(o=>Xe(o.tokenHash,a));return p||t.devices.find(o=>o.previousTokenHash&&o.previousValidUntil!==void 0&&n<o.previousValidUntil&&Xe(o.previousTokenHash,a))}function ot(t,e,n,a,p=Date.now()){let o=J(t,e,p);if(!o)return{ok:!1,reason:"\u8BBE\u5907\u4EE4\u724C\u65E0\u6548"};if(o.revokedAt)return{ok:!1,device:o,reason:"\u8BBE\u5907\u5DF2\u88AB\u540A\u9500"};if(o.expiresAt!==void 0&&p>o.expiresAt)return{ok:!1,device:o,reason:"\u8BBE\u5907\u4EE4\u724C\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u8BB0\u8BBE\u5907"};let b=t.members.find(v=>v.id===o.memberId);if(!b)return{ok:!1,device:o,reason:"\u8BBE\u5907\u6240\u5C5E\u6210\u5458\u5DF2\u4E0D\u5B58\u5728"};let h=o.grants.find(v=>v.channelId===n);return h?pe(h.role,a)?(o.lastSeenAt=Date.now(),{ok:!0,device:o,member:b}):{ok:!1,device:o,member:b,reason:`\u89D2\u8272 ${h.role} \u4E0D\u80FD\u6267\u884C ${a}`}:{ok:!1,device:o,member:b,reason:"\u8FD9\u53F0\u8BBE\u5907\u6CA1\u6709\u8BE5\u9891\u9053\u7684\u6388\u6743"}}function st(t,e,n,a){let p=t.members.find(k=>k.id===e);if(!p)return{ok:!1,reason:"\u6210\u5458\u4E0D\u5B58\u5728"};let o=t.devices.filter(k=>!k.revokedAt),b=o.filter(k=>k.memberId===e).flatMap(k=>k.grants).find(k=>k.channelId===n),h=b?.role??p.role;return(b?!0:o.some(k=>k.grants.some(T=>T.channelId===n)&&t.members.find(T=>T.id===k.memberId)?.orgId===p.orgId))?pe(h,a)?{ok:!0,member:p}:{ok:!1,member:p,reason:`\u89D2\u8272 ${h} \u4E0D\u80FD\u6267\u884C ${a}`}:{ok:!1,member:p,reason:"\u8FD9\u4E2A\u9891\u9053\u4E0D\u5C5E\u4E8E\u4F60\u6240\u5728\u7684\u7EC4\u7EC7"}}async function dt(t,e){await(0,V.mkdir)((0,Qe.dirname)(t),{recursive:!0}).catch(()=>{});let n=`${t}.tmp`;await(0,V.writeFile)(n,`${JSON.stringify(e,null,2)}
`,"utf8"),await(0,V.rename)(n,t)}async function lt(t){try{let e=await(0,V.readFile)(t,"utf8"),n=JSON.parse(e);return n.version!==Ee||!Array.isArray(n.orgs)||!Array.isArray(n.members)||!Array.isArray(n.devices)?void 0:{version:Ee,orgs:n.orgs,members:n.members,devices:n.devices}}catch{return}}function ct(t){return{version:t.version,orgs:t.orgs,members:t.members,devices:t.devices.map(e=>({id:e.id,memberId:e.memberId,name:e.name,platform:e.platform,grants:e.grants,createdAt:e.createdAt,lastSeenAt:e.lastSeenAt,revokedAt:e.revokedAt,hasPubkey:!!e.pubkey}))}}var ge=require("node:crypto"),pt={authorize:"https://accounts.feishu.cn/open-apis/authen/v1/authorize",token:"https://open.feishu.cn/open-apis/authen/v2/oauth/token",userinfo:"https://open.feishu.cn/open-apis/authen/v1/user_info"};function Oe(t){return t.toString("base64url")}function he(t,e){return Oe((0,ge.createHmac)("sha256",t).update(e,"utf8").digest())}function ut(t,e){let n=Buffer.from(t,"utf8"),a=Buffer.from(e,"utf8");return n.length===a.length&&(0,ge.timingSafeEqual)(n,a)}function ft(t,e){let n={...pt,...t.endpoints},a=new URL(n.authorize);return a.searchParams.set("client_id",t.appId),a.searchParams.set("app_id",t.appId),a.searchParams.set("redirect_uri",t.redirectUri),a.searchParams.set("response_type","code"),a.searchParams.set("state",e),a.toString()}function $e(t,e,n=10*6e4){let a=`${e}.${Date.now()+n}`;return`${Oe(Buffer.from(a,"utf8"))}.${he(t,a)}`}function Me(t,e,n=[]){if(!e)return{valid:!1};let a=e.lastIndexOf(".");if(a<=0)return{valid:!1};let p=e.slice(0,a),o=e.slice(a+1),b;try{b=Buffer.from(p,"base64url").toString("utf8")}catch{return{valid:!1}}if(!ut(he(t,b),o))return{valid:!1};let h=b.lastIndexOf("."),v=Number(b.slice(h+1));if(!Number.isFinite(v)||v<=Date.now())return{valid:!1};let k=h>0?b.slice(0,h):"",T=k.indexOf("~"),A=T>0?k.slice(T+1):"";return{valid:!0,nonce:k,...A&&n.includes(A)?{next:A}:{}}}function He(t,e){let n=Oe(Buffer.from(JSON.stringify(e),"utf8"));return`${n}.${he(t,n)}`}function ve(t,e){if(!e)return;let n=e.lastIndexOf(".");if(n<=0)return;let a=e.slice(0,n),p=e.slice(n+1);if(ut(he(t,a),p))try{let o=JSON.parse(Buffer.from(a,"base64url").toString("utf8"));return!o.memberId||typeof o.exp!="number"||o.exp<=Date.now()?void 0:o}catch{return}}function me(t){if(!t||typeof t!="object")return{};let e=t,n=e.data;return n&&typeof n=="object"?n:e}function M(t){return typeof t=="string"&&t.trim()?t.trim():void 0}async function mt(t,e,n=fetch){let a={...pt,...t.endpoints},p=[{grant_type:"authorization_code",client_id:t.appId,client_secret:t.appSecret,code:e,redirect_uri:t.redirectUri},{grant_type:"authorization_code",app_id:t.appId,app_secret:t.appSecret,code:e}],o="\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE access_token";for(let b of p)try{let h=await n(a.token,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)}),v=await h.json().catch(()=>{}),k=M(me(v).access_token);if(!h.ok||!k){o=M(me(v).error_description)??M(me(v).msg)??`HTTP ${h.status}`;continue}let A=await(await n(a.userinfo,{headers:{authorization:`Bearer ${k}`}})).json().catch(()=>{}),m=me(A),D=M(m.name)??M(m.en_name);if(!D){o="\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE\u7528\u6237\u59D3\u540D";continue}return{ok:!0,identity:{name:D,...M(m.email)??M(m.enterprise_email)?{email:M(m.email)??M(m.enterprise_email)}:{},...M(m.open_id)?{openId:M(m.open_id)}:{},...M(m.union_id)?{unionId:M(m.union_id)}:{}}}}catch(h){o=h instanceof Error?h.message:String(h)}return{ok:!1,error:o}}function gt(t,e){if(!e.length)return!0;if(!t)return!1;let n=t.lastIndexOf("@");if(n<0)return!1;let a=t.slice(n+1).toLowerCase();return e.some(p=>p.trim().toLowerCase().replace(/^@/,"")===a)}var Ft="1",Gt=96*1024,ht=9e4;function vt(t){return(0,H.createHash)("sha256").update(t,"utf8").digest("hex")}function l(t,e,n,a={}){let p=JSON.stringify(n);t.writeHead(e,{"content-type":"application/json; charset=utf-8","content-length":Buffer.byteLength(p),"cache-control":"no-store","x-content-type-options":"nosniff",...a}),t.end(p)}function B(t){return new Promise(e=>{let n=[],a=0;t.on("data",p=>{if(a+=p.length,a>Gt){e(void 0),t.destroy();return}n.push(p)}),t.on("end",()=>e(Buffer.concat(n).toString("utf8"))),t.on("error",()=>e(void 0))})}function U(t){let e=t.headers.authorization??"";return/^Bearer\s+(.+)$/i.exec(e.trim())?.[1]?.trim()??""}function C(t){let e=t.headers["x-real-ip"];if(typeof e=="string"&&e.trim())return e.trim();let n=t.headers["x-forwarded-for"];return typeof n=="string"&&n.trim()?n.split(",")[0].trim():(t.socket.remoteAddress??"").replace(/^::ffff:/,"")}async function yt(t={}){let e=Math.max(20,t.maxMessages??500),n=Math.max(1e3,Math.min(t.maxWaitMs??22e3,25e3)),a=Math.max(10,t.rateLimit??240),p=t.log??(()=>{}),o=new se(t.audit),b=new Map,h=new Map,v=Re(t.historyDir,e),k=(i,r)=>(i.ready||(i.ready=v.load(r).then(S=>{if(!S.length)return;let x=new Set(i.messages.map(E=>E.id));for(let E of S)x.has(E.id)||(i.messages.push({seq:E.seq,id:E.id,from:E.from,envelope:{iv:E.iv,ct:E.ct},at:E.at}),i.seen.add(E.id),E.seq>i.seq&&(i.seq=E.seq));i.messages.sort((E,$)=>E.seq-$.seq),i.messages.length>e&&(i.messages=i.messages.slice(-e)),p(`[relay] \u9891\u9053 ${r.slice(0,8)}\u2026 \u4ECE\u78C1\u76D8\u6062\u590D ${S.length} \u6761\uFF0Cseq=${i.seq}`)}).catch(()=>{})),i.ready),T=(i,r)=>{let S=b.get(i);if(S)return S.keyHash===vt(r)?S:void 0;if(!/^[0-9a-f]{16,64}$/.test(i))return;let x={keyHash:vt(r),createdAt:Date.now(),seq:0,messages:[],waiters:[],seen:new Set,presence:new Map};return b.set(i,x),k(x,i),p(`[relay] \u65B0\u9891\u9053 ${i.slice(0,8)}\u2026`),x},A=i=>{let r=Date.now(),S=h.get(i);return!S||r>=S.resetAt?(h.set(i,{count:1,resetAt:r+6e4}),!0):(S.count+=1,S.count<=a)},m=t.identity,D=t.adminToken??"",W=new de,ie=new le,j=()=>t.auth?.secret??t.github?.secret??"",te=()=>t.auth?.sessionTtlMs??t.github?.sessionTtlMs??720*6e4,Y=()=>!!((t.auth||t.github)&&m),Z=i=>{if(!/^[0-9a-f]{16,64}$/.test(i))return;let r=b.get(i);if(r)return r;let S={keyHash:"",createdAt:Date.now(),seq:0,messages:[],waiters:[],seen:new Set,presence:new Map};return b.set(i,S),k(S,i),p(`[relay] \u65B0\u9891\u9053 ${i.slice(0,8)}\u2026\uFF08\u8EAB\u4EFD\u6A21\u5F0F\uFF09`),S},ne=(i,r,S)=>{if(!m)return{ok:!0};let x=U(i);if(x){let X=ot(m.state,x,r,S);return X.ok?{ok:!0,deviceId:X.device?.id,member:X.member?.name}:{ok:!1,status:403,reason:X.reason??"\u672A\u6388\u6743"}}let E=j();if(!E)return{ok:!1,status:403,reason:"\u8BBE\u5907\u4EE4\u724C\u65E0\u6548"};let $=ve(E,ce(i.headers.cookie).plaitcode_session);if(!$)return{ok:!1,status:401,reason:"\u672A\u767B\u5F55\uFF1A\u8BF7\u5148\u7528 GitHub \u6216\u98DE\u4E66\u767B\u5F55"};let re=st(m.state,$.memberId,r,S);return re.ok?{ok:!0,member:re.member?.name}:{ok:!1,status:403,reason:re.reason??"\u672A\u6388\u6743"}},_=async()=>{m?.path&&await dt(m.path,m.state).catch(i=>{p(`[relay] \u8EAB\u4EFD\u5E93\u5199\u5165\u5931\u8D25\uFF1A${i instanceof Error?i.message:String(i)}`)})},L=i=>{if(!D||typeof i!="string")return!1;let r=(0,H.createHash)("sha256").update(i).digest(),S=(0,H.createHash)("sha256").update(D).digest();return r.length===S.length&&(0,H.timingSafeEqual)(r,S)},Tt=async(i,r)=>{let S=r.orgs.find(s=>s.id===i.orgId),x=r.members.filter(s=>s.orgId===i.orgId),E=new Set(x.map(s=>s.id)),$=r.devices.filter(s=>E.has(s.memberId)),re=new Map(x.map(s=>[s.id,s.name])),X=Date.now(),ke=s=>{let y=b.get(s),I=new Set;if(!y)return I;for(let[w,O]of y.presence)X-O.at<=ht&&I.add(w);return I},f=new Set;for(let s of $)for(let y of s.grants)f.add(y.channelId);let d=new Set;for(let s of f)for(let y of ke(s))d.add(y);let c=[...f].sort().map(s=>{let y=$.filter(F=>F.grants.some(G=>G.channelId===s)),I=ke(s),w=y.filter(F=>I.has(F.id)&&!F.revokedAt),O=b.get(s),P=O?.messages.length?O.messages[O.messages.length-1]:void 0;return{channelId:s,devices:y.length,online:w.length,deviceNames:w.map(F=>F.name).slice(0,8),...P?{lastMessageAt:P.at}:{}}}),u=(await o.tail(300)).filter(s=>typeof s.channel=="string"&&f.has(s.channel)).slice(0,120);return{ok:!0,member:{id:i.id,name:i.name,role:i.role,email:i.email??null},org:S?{id:S.id,name:S.name}:null,members:x.map(s=>({id:s.id,name:s.name,role:s.role,email:s.email??null,createdAt:s.createdAt})),devices:$.map(s=>({id:s.id,memberId:s.memberId,memberName:re.get(s.memberId)??"",name:s.name,platform:s.platform,grants:s.grants,createdAt:s.createdAt,...s.lastSeenAt?{lastSeenAt:s.lastSeenAt}:{},...s.expiresAt?{expiresAt:s.expiresAt}:{},...s.revokedAt?{revokedAt:s.revokedAt}:{},online:d.has(s.id)&&!s.revokedAt})),channels:c,audit:u,counts:{devices:$.filter(s=>!s.revokedAt).length,online:$.filter(s=>!s.revokedAt&&d.has(s.id)).length,channels:c.length,members:x.length}}},ae=(0,bt.createServer)((i,r)=>{(async()=>{let S=i.url??"/",x=S.split("?")[0]??"/",E=new URLSearchParams(S.slice(S.indexOf("?")+1)),$=x==="/health";if(!($||(x==="/manifest.webmanifest"||x==="/sw.js"||x==="/icon.svg")||(x==="/"||x==="/m"||x==="/console"))){let f=C(i);if(!A(f)){o.record({event:"denied",ip:f,detail:"rate limited"}),l(r,429,{ok:!1,error:"too many requests"});return}}if(i.method==="GET"&&x==="/"){let f=Fe({relayHost:typeof i.headers.host=="string"?i.headers.host:"plaitcode.com",consoleEnabled:Y(),installUrl:"https://marketplace.visualstudio.com/items?itemName=plaitcode.plaitcode",repoUrl:"https://github.com/Gsaecy/PlaitCode"});r.writeHead(200,{"content-type":"text/html; charset=utf-8","content-length":Buffer.byteLength(f),"cache-control":"public, max-age=300","x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"no-referrer"}),r.end(f);return}if(i.method==="GET"&&x==="/console"){let f=Ge({relayHost:typeof i.headers.host=="string"?i.headers.host:"plaitcode.com",sessionAuth:Y()});r.writeHead(200,{"content-type":"text/html; charset=utf-8","content-length":Buffer.byteLength(f),"cache-control":"no-store","x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"no-referrer"}),r.end(f);return}if(i.method==="GET"&&x==="/m"){let f=je({relayHost:typeof i.headers.host=="string"?i.headers.host:"plaitcode.com",sessionAuth:Y(),...t.github?{loginPath:"/v1/auth/github/start",loginLabel:"GitHub"}:{loginPath:"/v1/auth/feishu/start",loginLabel:"\u98DE\u4E66"}});r.writeHead(200,{"content-type":"text/html; charset=utf-8","content-length":Buffer.byteLength(f),"cache-control":"no-store","x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"no-referrer"}),r.end(f);return}if(i.method==="GET"&&x==="/manifest.webmanifest"){let f=Ze();r.writeHead(200,{"content-type":"application/manifest+json; charset=utf-8","content-length":Buffer.byteLength(f),"cache-control":"public, max-age=3600","x-content-type-options":"nosniff"}),r.end(f);return}if(i.method==="GET"&&x==="/sw.js"){r.writeHead(200,{"content-type":"application/javascript; charset=utf-8","content-length":Buffer.byteLength(Ce),"cache-control":"no-cache","service-worker-allowed":"/","x-content-type-options":"nosniff"}),r.end(Ce);return}if(i.method==="GET"&&x==="/icon.svg"){r.writeHead(200,{"content-type":"image/svg+xml; charset=utf-8","content-length":Buffer.byteLength(Se),"cache-control":"public, max-age=86400","x-content-type-options":"nosniff"}),r.end(Se);return}if(x==="/v1/auth/device/start"&&i.method==="POST"){if(!m||!t.github){l(r,404,{ok:!1,error:"github login disabled"});return}let f=await B(i);if(f===void 0){l(r,413,{ok:!1,error:"body too large"});return}let d={};if(f)try{d=JSON.parse(f)}catch{l(r,400,{ok:!1,error:"invalid json"});return}let c=W.start({deviceName:typeof d.deviceName=="string"?d.deviceName:void 0,platform:typeof d.platform=="string"?d.platform:void 0}),g=typeof i.headers.host=="string"?i.headers.host:"plaitcode.com",u=i.headers["x-forwarded-proto"]==="https"?"https":"http";l(r,200,{ok:!0,code:c.code,expiresIn:c.expiresIn,verifyUrl:`${u}://${g}/v1/auth/github/start?device=${encodeURIComponent(c.code)}`});return}if(x==="/v1/auth/device/poll"&&i.method==="GET"){if(!m||!t.github){l(r,404,{ok:!1,error:"github login disabled"});return}let f=W.poll(E.get("code")??"");if(f.status==="expired"){l(r,404,{ok:!1,error:"\u767B\u5F55\u7801\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u5728 VS Code \u91CC\u91CD\u65B0\u5F00\u59CB"});return}if(f.status==="pending"){l(r,200,{ok:!0,status:"pending"});return}o.record({event:"login",ip:C(i),detail:`device-code ${f.result?.deviceId??""}`}),l(r,200,{ok:!0,status:"ready",...f.result});return}if(x==="/v1/auth/github/start"&&i.method==="GET"){let f=t.github;if(!f||!m){l(r,404,{ok:!1,error:"github login disabled"});return}let d=E.get("next")==="console"?"console":"",c=(E.get("device")??"").trim(),g=c?`${(0,H.randomUUID)()}~d${c}`:d?`${(0,H.randomUUID)()}~${d}`:(0,H.randomUUID)(),u=$e(f.secret,g);r.writeHead(302,{location:We(f.config,u),"cache-control":"no-store"}),r.end();return}if(x==="/v1/auth/github/callback"&&i.method==="GET"){let f=t.github;if(!f||!m){l(r,404,{ok:!1,error:"github login disabled"});return}let d=Me(f.secret,E.get("state")??void 0,["console"]);if(!d.valid){o.record({event:"denied",ip:C(i),detail:"github state invalid"}),l(r,400,{ok:!1,error:"state \u65E0\u6548\u6216\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55"});return}let c=E.get("code")??"";if(!c){l(r,400,{ok:!1,error:"\u7F3A\u5C11 code"});return}let g=await Ye(f.config,c);if(!g.ok){o.record({event:"denied",ip:C(i),detail:`github exchange failed: ${g.error}`}),l(r,502,{ok:!1,error:`GitHub \u767B\u5F55\u5931\u8D25\uFF1A${g.error}`});return}let u=g.identity,s=Pe(m.state,{githubId:u.githubId});if(!s){let P=Te(m.state,u.login);s=ue(m.state,{orgId:P.id,name:u.name,role:"owner",githubId:u.githubId,githubLogin:u.login,...u.email?{email:u.email}:{}}),s&&(await _(),o.record({event:"admin",ip:C(i),detail:`github provision ${u.login}`}))}if(!s){l(r,409,{ok:!1,error:"\u65E0\u6CD5\u5EFA\u7ACB\u6210\u5458\u8EAB\u4EFD"});return}let y=!1;s.githubLogin!==u.login&&(s.githubLogin=u.login,y=!0),u.email&&s.email!==u.email&&(s.email=u.email,y=!0),y&&await _();let I=/~d([0-9A-Z-]{4,16})$/.exec(d.nonce??"")?.[1];if(I){let P=W.peek(I);if(!P){r.writeHead(410,{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}),r.end(Ie({ok:!1,title:"\u767B\u5F55\u7801\u5DF2\u8FC7\u671F",body:"\u56DE\u5230 VS Code \u91CD\u65B0\u6267\u884C\u4E00\u6B21\u300C\u5F00\u59CB\u534F\u4F5C\u300D\u5373\u53EF\u3002"}));return}let F=new Map;for(let Q of m.state.devices)if(!(Q.memberId!==s.id||Q.revokedAt))for(let oe of Q.grants)F.set(oe.channelId,oe.role);let G=fe(m.state,{memberId:s.id,name:P.deviceName,platform:P.platform,channels:[...F].map(([Q,oe])=>({channelId:Q,role:oe}))});if(!G){l(r,409,{ok:!1,error:"\u8BBE\u5907\u767B\u8BB0\u5931\u8D25"});return}await _();let Pt=m.state.orgs.find(Q=>Q.id===s.orgId),_t={token:G.token,deviceId:G.device.id,memberId:s.id,memberName:s.name,orgId:s.orgId,orgName:Pt?.name??"",grants:G.device.grants};W.bind(I,_t),o.record({event:"admin",ip:C(i),detail:`device login ${s.githubLogin} \u2192 ${G.device.name}`}),r.writeHead(200,{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}),r.end(Ie({ok:!0,title:"\u767B\u5F55\u5B8C\u6210",body:`\u5DF2\u4E3A\u300C${G.device.name}\u300D\u6388\u6743\u3002\u8FD9\u4E2A\u7A97\u53E3\u53EF\u4EE5\u5173\u6389\uFF0C\u56DE\u5230 VS Code \u5C31\u4F1A\u81EA\u52A8\u7EE7\u7EED\u3002`}));return}let w=te(),O=He(j(),{memberId:s.id,name:s.name,...s.email?{email:s.email}:{},exp:Date.now()+w});o.record({event:"login",ip:C(i),detail:s.githubLogin??s.name}),r.writeHead(302,{location:d.next==="console"?"/console":"/m","set-cookie":`plaitcode_session=${O}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(w/1e3)}`,"cache-control":"no-store"}),r.end();return}if(x==="/v1/auth/feishu/start"&&i.method==="GET"){let f=t.auth;if(!f||!m){l(r,404,{ok:!1,error:"sso disabled"});return}let d=E.get("next")==="console"?"console":"",c=$e(f.secret,d?`${(0,H.randomUUID)()}~${d}`:(0,H.randomUUID)());r.writeHead(302,{location:ft(f.config,c),"cache-control":"no-store"}),r.end();return}if(x==="/v1/auth/feishu/callback"&&i.method==="GET"){let f=t.auth;if(!f||!m){l(r,404,{ok:!1,error:"sso disabled"});return}let d=Me(f.secret,E.get("state")??void 0,["console"]);if(!d.valid){o.record({event:"denied",ip:C(i),detail:"sso state invalid"}),l(r,400,{ok:!1,error:"state \u65E0\u6548\u6216\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55"});return}let c=E.get("code")??"";if(!c){l(r,400,{ok:!1,error:"\u7F3A\u5C11 code"});return}let g=await mt(f.config,c);if(!g.ok){o.record({event:"denied",ip:C(i),detail:`sso exchange failed: ${g.error}`}),l(r,502,{ok:!1,error:`\u98DE\u4E66\u767B\u5F55\u5931\u8D25\uFF1A${g.error}`});return}if(f.emailDomains?.length&&!g.identity.email){o.record({event:"denied",ip:C(i),detail:"sso email missing while domain allowlist configured"}),l(r,403,{ok:!1,error:"\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE\u90AE\u7BB1\uFF0C\u65E0\u6CD5\u6821\u9A8C\u57DF\u540D\u767D\u540D\u5355\u3002\u8BF7\u7ED9\u5E94\u7528\u5F00\u901A contact:user.email:readonly \u6743\u9650\u5E76\u53D1\u5E03\u7248\u672C\uFF0C\u6216\u628A PLAITCODE_AUTH_EMAIL_DOMAINS \u6E05\u7A7A\u3002"});return}if(!gt(g.identity.email,f.emailDomains??[])){o.record({event:"denied",ip:C(i),detail:`sso email not allowed: ${g.identity.email??"(none)"}`}),l(r,403,{ok:!1,error:"\u8FD9\u4E2A\u90AE\u7BB1\u4E0D\u5728\u5141\u8BB8\u7684\u57DF\u540D\u5185"});return}let u=g.identity,s=Pe(m.state,u);if(!s&&(u.email||u.openId||u.unionId)){let w=m.state.orgs[0];if(!w){l(r,409,{ok:!1,error:"\u670D\u52A1\u7AEF\u8FD8\u6CA1\u6709\u7EC4\u7EC7\uFF0C\u8BF7\u7BA1\u7406\u5458\u5148\u5EFA\u7EC4\u7EC7"});return}s=ue(m.state,{orgId:w.id,name:u.name,role:"member",email:u.email,openId:u.openId,unionId:u.unionId}),s&&(await _(),o.record({event:"admin",ip:C(i),detail:`auto-provision ${u.email??u.openId??u.unionId}`}))}if(!s){o.record({event:"denied",ip:C(i),detail:"sso identity has no stable key"}),l(r,409,{ok:!1,error:"\u65E0\u6CD5\u5EFA\u7ACB\u6210\u5458\u8EAB\u4EFD\uFF1A\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE\u53EF\u7528\u4E8E\u8BC6\u522B\u8EAB\u4EFD\u7684\u6807\u8BC6\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458"});return}u.email&&!s.email&&(s.email=u.email,await _());let y=te(),I=He(j(),{memberId:s.id,name:s.name,...g.identity.email?{email:g.identity.email}:{},exp:Date.now()+y});o.record({event:"login",ip:C(i),detail:s.name}),r.writeHead(302,{location:d.next==="console"?"/console":"/m","set-cookie":`plaitcode_session=${I}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(y/1e3)}`,"cache-control":"no-store"}),r.end();return}if(x==="/v1/auth/me"&&i.method==="GET"){if(!t.auth){l(r,404,{ok:!1,error:"sso disabled"});return}let d=ve(j(),ce(i.headers.cookie).plaitcode_session);if(!d){l(r,401,{ok:!1,error:"\u672A\u767B\u5F55"});return}l(r,200,{ok:!0,member:{id:d.memberId,name:d.name,email:d.email??null}});return}if(x==="/v1/auth/logout"&&i.method==="POST"){r.writeHead(200,{"content-type":"application/json; charset=utf-8","set-cookie":"plaitcode_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"}),r.end(JSON.stringify({ok:!0}));return}if(x==="/v1/devices/enroll"&&i.method==="POST"){if(!m){l(r,404,{ok:!1,error:"identity disabled"});return}if(t.selfEnroll===!1){l(r,403,{ok:!1,error:"self enrollment disabled"});return}let f=U(i),d=f?J(m.state,f):void 0,c=d&&!d.revokedAt&&(d.expiresAt===void 0||Date.now()<=d.expiresAt)?d:void 0;if(!c){o.record({event:"denied",ip:C(i),detail:"enroll auth failed"}),l(r,403,{ok:!1,error:"\u9700\u8981\u7528\u5DF2\u767B\u8BB0\u7684\u8BBE\u5907\u4EE4\u724C\u8C03\u7528"});return}let g=await B(i);if(g===void 0){l(r,413,{ok:!1,error:"body too large"});return}let u={};if(g)try{u=JSON.parse(g)}catch{l(r,400,{ok:!1,error:"invalid json"});return}let s=fe(m.state,{memberId:c.memberId,name:String(u.name??"\u65B0\u8BBE\u5907"),platform:typeof u.platform=="string"?u.platform:void 0,channels:c.grants.map(y=>({channelId:y.channelId,role:y.role}))});if(!s){l(r,409,{ok:!1,error:"\u6210\u5458\u4E0D\u5B58\u5728"});return}await _(),o.record({event:"admin",ip:C(i),detail:`self-enroll ${s.device.name}`}),l(r,200,{ok:!0,device:{id:s.device.id,name:s.device.name,grants:s.device.grants},token:s.token});return}if(x==="/v1/devices/me"&&i.method==="GET"){if(!m){l(r,404,{ok:!1,error:"identity disabled"});return}let f=U(i),d=f?J(m.state,f):void 0;if(!d||d.revokedAt){l(r,403,{ok:!1,error:"\u9700\u8981\u7528\u5DF2\u767B\u8BB0\u7684\u8BBE\u5907\u4EE4\u724C\u8C03\u7528"});return}let c=m.state.members.find(u=>u.id===d.memberId),g=c?m.state.orgs.find(u=>u.id===c.orgId):void 0;l(r,200,{ok:!0,deviceId:d.id,deviceName:d.name,memberId:d.memberId,memberName:c?.name??"",...c?.githubId?{githubId:c.githubId}:{},...c?.githubLogin?{githubLogin:c.githubLogin}:{},orgId:c?.orgId??"",orgName:g?.name??"",grants:d.grants,needsKey:d.needsKey===!0});return}if(x==="/v1/devices/pubkey"&&i.method==="POST"){if(!m){l(r,404,{ok:!1,error:"identity disabled"});return}let f=U(i),d=f?J(m.state,f):void 0;if(!d||d.revokedAt){l(r,403,{ok:!1,error:"\u9700\u8981\u7528\u5DF2\u767B\u8BB0\u7684\u8BBE\u5907\u4EE4\u724C\u8C03\u7528"});return}let c=await B(i),g={};if(c)try{g=JSON.parse(c)}catch{l(r,400,{ok:!1,error:"invalid json"});return}let u=typeof g.pubkey=="string"?g.pubkey:"";if(!rt(m.state,d.id,u,g.needsKey!==!1)){l(r,400,{ok:!1,error:"\u516C\u94A5\u683C\u5F0F\u4E0D\u5BF9"});return}await _(),l(r,200,{ok:!0,needsKey:d.needsKey===!0});return}if(x==="/v1/handoff"){if(!m){l(r,404,{ok:!1,error:"identity disabled"});return}let f=U(i),d=f?J(m.state,f):void 0;if(!d||d.revokedAt){l(r,403,{ok:!1,error:"\u9700\u8981\u7528\u5DF2\u767B\u8BB0\u7684\u8BBE\u5907\u4EE4\u724C\u8C03\u7528"});return}if(i.method==="GET"){let c=ie.take(d.id),g=c?m.state.devices.find(y=>y.id===c.fromDeviceId):void 0,u=c?{...c,fromPubkey:g?.pubkey??""}:void 0,s=m.state.devices.filter(y=>y.memberId===d.memberId&&y.id!==d.id&&!y.revokedAt&&y.needsKey===!0&&typeof y.pubkey=="string").map(y=>({deviceId:y.id,name:y.name,platform:y.platform,pubkey:y.pubkey}));l(r,200,{ok:!0,...u?{incoming:u}:{},peers:s,needsKey:d.needsKey===!0});return}if(i.method==="POST"){let c=await B(i);if(c===void 0){l(r,413,{ok:!1,error:"body too large"});return}let g={};if(c)try{g=JSON.parse(c)}catch{l(r,400,{ok:!1,error:"invalid json"});return}if(g.done===!0){it(m.state,d.id),await _(),l(r,200,{ok:!0});return}let u=String(g.toDeviceId??""),s=m.state.devices.find(I=>I.id===u);if(!s||s.revokedAt||s.needsKey!==!0||!s.pubkey){l(r,404,{ok:!1,error:"\u76EE\u6807\u8BBE\u5907\u4E0D\u5728\u7B49\u5F85\u5217\u8868\u91CC"});return}if(s.memberId!==d.memberId){o.record({event:"denied",ip:C(i),detail:"handoff cross-member denied"}),l(r,403,{ok:!1,error:"\u53EA\u80FD\u7ED9\u81EA\u5DF1\u7684\u5176\u5B83\u8BBE\u5907\u4EA4\u63A5"});return}let y=ie.put({fromDeviceId:d.id,toDeviceId:u,iv:String(g.iv??""),ct:String(g.ct??""),at:Date.now()});if(!y.ok){l(r,400,{ok:!1,error:y.error});return}o.record({event:"admin",ip:C(i),detail:`handoff ${d.id} \u2192 ${u}`}),l(r,200,{ok:!0});return}l(r,405,{ok:!1,error:"method not allowed"});return}if(x==="/v1/channels/claim"&&i.method==="POST"){if(!m){l(r,404,{ok:!1,error:"identity disabled"});return}let f=U(i),d=f?J(m.state,f):void 0;if(!d||d.revokedAt){l(r,403,{ok:!1,error:"\u9700\u8981\u7528\u5DF2\u767B\u8BB0\u7684\u8BBE\u5907\u4EE4\u724C\u8C03\u7528"});return}let c=await B(i),g={};if(c)try{g=JSON.parse(c)}catch{l(r,400,{ok:!1,error:"invalid json"});return}let u=String(g.channelId??"").trim();if(!at(m.state,d.id,u)){l(r,400,{ok:!1,error:"\u9891\u9053 id \u683C\u5F0F\u4E0D\u5BF9\uFF0C\u6216\u8BBE\u5907\u6388\u6743\u5DF2\u6EE1"});return}await _(),o.record({event:"admin",ip:C(i),detail:`claim ${u.slice(0,8)} by ${d.name}`}),l(r,200,{ok:!0,grants:d.grants});return}if(x==="/v1/notify"&&i.method==="POST"){let f=t.notifyHook?.trim();if(!f){l(r,404,{ok:!1,error:"notify disabled"});return}let d=U(i),c=m&&d?J(m.state,d):void 0;if(m&&(!c||c.revokedAt)){o.record({event:"denied",ip:C(i),detail:"notify auth failed"}),l(r,403,{ok:!1,error:"\u9700\u8981\u7528\u5DF2\u767B\u8BB0\u7684\u8BBE\u5907\u4EE4\u724C\u8C03\u7528"});return}let g=await B(i);if(g===void 0){l(r,413,{ok:!1,error:"body too large"});return}let u={};try{u=g?JSON.parse(g):{}}catch{l(r,400,{ok:!1,error:"invalid json"});return}let s=u.kind==="approval"||u.kind==="done"||u.kind==="blocked"?u.kind:void 0;if(!s){l(r,400,{ok:!1,error:"kind must be approval/done/blocked"});return}let y={kind:s,title:String(u.title??"").slice(0,120),summary:String(u.summary??"").slice(0,500),...typeof u.source=="string"?{source:u.source.slice(0,120)}:{}},I=t.auth?.config?.redirectUri?(()=>{try{return new URL(t.auth.config.redirectUri).origin}catch{return""}})():"",w=await Ne(f,y,I?`${I}/m`:"");o.record({event:"admin",ip:C(i),detail:`notify ${s} -> ${w.ok?"sent":`failed: ${w.error}`}`}),l(r,w.ok?200:502,w.ok?{ok:!0}:{ok:!1,error:w.error});return}if(x.startsWith("/v1/console/")){if(!m){l(r,404,{ok:!1,error:"identity disabled"});return}if(!Y()){l(r,404,{ok:!1,error:"sso disabled"});return}let f=ve(j(),ce(i.headers.cookie).plaitcode_session);if(!f){let c=t.github?"/v1/auth/github/start?next=console":"/v1/auth/feishu/start?next=console";l(r,401,{ok:!1,error:"\u672A\u767B\u5F55",login:c});return}let d=m.state.members.find(c=>c.id===f.memberId);if(!d){o.record({event:"denied",ip:C(i),detail:"console member missing"}),l(r,403,{ok:!1,error:"\u6210\u5458\u4E0D\u5B58\u5728\u6216\u5DF2\u88AB\u79FB\u9664"});return}if(x==="/v1/console/state"&&i.method==="GET"){l(r,200,await Tt(d,m.state));return}if(x==="/v1/console/devices/revoke"&&i.method==="POST"){let c=await B(i);if(c===void 0){l(r,413,{ok:!1,error:"body too large"});return}let g={};if(c)try{g=JSON.parse(c)}catch{l(r,400,{ok:!1,error:"invalid json"});return}let u=String(g.deviceId??""),s=m.state.devices.find(w=>w.id===u);if(!s){l(r,404,{ok:!1,error:"\u8BBE\u5907\u4E0D\u5B58\u5728"});return}let y=m.state.members.find(w=>w.id===s.memberId);if(!y||y.orgId!==d.orgId){l(r,404,{ok:!1,error:"\u8BBE\u5907\u4E0D\u5B58\u5728"});return}if(s.memberId!==d.id&&!pe(d.role,"manage")){o.record({event:"denied",ip:C(i),detail:`console revoke denied: ${d.name}`}),l(r,403,{ok:!1,error:"\u53EA\u6709\u7BA1\u7406\u5458\u80FD\u540A\u9500\u522B\u4EBA\u7684\u8BBE\u5907"});return}let I=_e(m.state,u);I&&await _(),o.record({event:"admin",ip:C(i),detail:`console revoke ${s.name} by ${d.name} -> ${I}`}),l(r,I?200:404,{ok:I});return}l(r,404,{ok:!1,error:"not found"});return}if(x.startsWith("/v1/admin/")){if(!m||!D){l(r,404,{ok:!1,error:"admin api disabled"});return}if(!L(i.headers["x-plaitcode-admin"])){o.record({event:"denied",ip:C(i),detail:"admin auth failed"}),l(r,403,{ok:!1,error:"admin denied"});return}let f=i.method==="POST"?await B(i):"";if(f===void 0){l(r,413,{ok:!1,error:"body too large"});return}let d={};if(f)try{d=JSON.parse(f)}catch{l(r,400,{ok:!1,error:"invalid json"});return}if(x==="/v1/admin/state"&&i.method==="GET"){l(r,200,{ok:!0,identity:ct(m.state)});return}if(x==="/v1/admin/orgs"&&i.method==="POST"){let c=Te(m.state,String(d.name??""));await _(),o.record({event:"admin",ip:C(i),detail:`org ${c.name}`}),l(r,200,{ok:!0,org:c});return}if(x==="/v1/admin/members"&&i.method==="POST"){let c=ue(m.state,{orgId:String(d.orgId??""),name:String(d.name??""),role:d.role});if(!c){l(r,404,{ok:!1,error:"org not found"});return}await _(),o.record({event:"admin",ip:C(i),detail:`member ${c.name} (${c.role})`}),l(r,200,{ok:!0,member:c});return}if(x==="/v1/admin/devices"&&i.method==="POST"){let c=Array.isArray(d.channels)?d.channels:[],g=fe(m.state,{memberId:String(d.memberId??""),name:String(d.name??""),platform:typeof d.platform=="string"?d.platform:void 0,channels:c.filter(u=>!!u&&typeof u=="object").map(u=>({channelId:String(u.channelId??""),role:u.role}))});if(!g){l(r,404,{ok:!1,error:"member not found"});return}await _(),o.record({event:"admin",ip:C(i),detail:`device ${g.device.name} for ${g.device.memberId}`}),l(r,200,{ok:!0,device:{id:g.device.id,memberId:g.device.memberId,name:g.device.name,grants:g.device.grants},token:g.token});return}if(x==="/v1/admin/devices/revoke"&&i.method==="POST"){let c=_e(m.state,String(d.deviceId??""));await _(),o.record({event:"admin",ip:C(i),detail:`revoke ${String(d.deviceId??"")} -> ${c}`}),l(r,c?200:404,{ok:c});return}l(r,404,{ok:!1,error:"not found"});return}if(i.method==="GET"&&$){l(r,200,{ok:!0,service:"plaitcode-relay",version:Ft,channels:b.size,uptime:Math.round(process.uptime())});return}if(!x.startsWith("/v1/")){l(r,404,{ok:!1,error:"not found"});return}if(i.method==="GET"&&x==="/v1/poll"){let f=E.get("channel")??"",d=ne(i,f,"poll");if(!d.ok){o.record({event:"denied",channel:f.slice(0,32),ip:C(i),detail:d.reason}),l(r,d.status,{ok:!1,error:d.reason});return}let c=m?Z(f):T(f,U(i));if(!c){l(r,403,{ok:!1,error:"channel denied"});return}c.ready&&await c.ready;let g=Number(E.get("since")??0)||0,u=Math.min(Math.max(Number(E.get("wait")??20)*1e3||2e4,0),n),s=()=>c.messages.filter(P=>P.seq>g),y=s();if(y.length||u===0){l(r,200,{ok:!0,messages:y.slice(-200),seq:c.seq});return}let I=!1,w=()=>{if(I)return;I=!0;let P=c.waiters.indexOf(w);P>=0&&c.waiters.splice(P,1),clearTimeout(O),!r.writableEnded&&l(r,200,{ok:!0,messages:s().slice(-200),seq:c.seq})},O=setTimeout(w,u);O.unref?.(),c.waiters.push(w),i.on("close",()=>{if(I)return;I=!0;let P=c.waiters.indexOf(w);P>=0&&c.waiters.splice(P,1),clearTimeout(O)});return}if(i.method==="POST"&&x==="/v1/publish"){let f=await B(i);if(!f){l(r,413,{ok:!1,error:"body too large"});return}let d;try{d=JSON.parse(f)}catch{l(r,400,{ok:!1,error:"invalid json"});return}let c=typeof d.channel=="string"?d.channel:"",g=typeof d.id=="string"?d.id.slice(0,80):"",u=typeof d.from=="string"?d.from.slice(0,80):"",s=typeof d.envelope?.iv=="string"?d.envelope.iv:"",y=typeof d.envelope?.ct=="string"?d.envelope.ct:"";if(!g||!u||!s||!y||y.length>64*1024){l(r,400,{ok:!1,error:"invalid message"});return}let I=ne(i,c,"publish");if(!I.ok){o.record({event:"denied",channel:c.slice(0,32),ip:C(i),detail:I.reason}),l(r,I.status,{ok:!1,error:I.reason});return}let w=m?Z(c):T(c,U(i));if(!w){o.record({event:"denied",channel:c.slice(0,32),ip:C(i),detail:"channel denied"}),l(r,403,{ok:!1,error:"channel denied"});return}if(w.ready&&await w.ready,w.seen.has(g)){o.record({event:"publish",channel:c,device:u,message:g,ip:C(i),detail:"duplicate"}),l(r,200,{ok:!0,duplicate:!0,seq:w.seq});return}w.seq+=1,w.seen.add(g),o.record({event:"publish",channel:c,device:u,message:g,ip:C(i),bytes:y.length}),w.seen.size>e*4&&(w.seen=new Set([...w.seen].slice(-e*2)));let O={seq:w.seq,id:g,from:u,envelope:{iv:s,ct:y},at:Date.now()};w.messages.push(O),v.append(c,{seq:O.seq,id:O.id,from:O.from,iv:s,ct:y,at:O.at}),w.messages.length>e&&(w.messages=w.messages.slice(-e));for(let P of[...w.waiters])P();l(r,200,{ok:!0,seq:w.seq});return}if(x==="/v1/presence"){let f=U(i),d=E.get("channel")??"",c;if(i.method==="POST"){let y=await B(i);if(!y){l(r,413,{ok:!1,error:"body too large"});return}let I;try{I=JSON.parse(y)}catch{l(r,400,{ok:!1,error:"invalid json"});return}d=typeof I.channel=="string"?I.channel:"",c=I.device}let g=ne(i,d,"presence");if(!g.ok){o.record({event:"denied",channel:d.slice(0,32),ip:C(i),detail:g.reason}),l(r,g.status,{ok:!1,error:g.reason});return}let u=m?Z(d):T(d,f);if(!u){l(r,403,{ok:!1,error:"channel denied"});return}if(c){let y=g.deviceId??(typeof c.id=="string"?c.id.slice(0,80):"");if(!y){l(r,400,{ok:!1,error:"invalid device"});return}u.presence.set(y,{name:g.member?`${g.member} \xB7 ${typeof c.name=="string"?c.name.slice(0,60):"\u8BBE\u5907"}`:typeof c.name=="string"?c.name.slice(0,120):y,platform:typeof c.platform=="string"?c.platform:"unknown",project:typeof c.project=="string"?c.project.slice(0,120):"",at:Date.now()})}let s=Date.now();for(let[y,I]of u.presence)s-I.at>ht&&u.presence.delete(y);l(r,200,{ok:!0,devices:[...u.presence.entries()].map(([y,I])=>({id:y,...I}))});return}l(r,404,{ok:!1,error:"not found"})})().catch(S=>{p(`[relay] \u8BF7\u6C42\u5904\u7406\u5931\u8D25\uFF1A${S instanceof Error?S.message:String(S)}`),r.writableEnded||l(r,500,{ok:!1,error:"internal error"})})});await new Promise((i,r)=>{ae.once("error",r),ae.listen(t.port??8787,t.host??"0.0.0.0",()=>{ae.off("error",r),i()})});let ye=ae.address(),xe=ye&&typeof ye=="object"?ye.port:t.port??8787;return p(`[relay] \u76D1\u542C ${t.host??"0.0.0.0"}:${xe}`),o.record({event:"startup",detail:`listen ${t.host??"0.0.0.0"}:${xe}`}),{port:xe,close:()=>new Promise(i=>{o.record({event:"shutdown"});for(let r of b.values())for(let S of[...r.waiters])S();ae.close(()=>{Promise.all([o.flush(),v.flush()]).then(()=>i())}),setTimeout(()=>i(),1500).unref?.()})}}var kt=require("node:dgram"),wt=require("node:http"),It=require("node:https"),St=require("node:net");function Ct(t){let e=(t??"").trim();if(e)try{if(/^otlp\+https?:\/\//i.test(e))return{kind:"otlp",url:new URL(e.replace(/^otlp\+/i,""))};if(/^syslog\+tcp:\/\//i.test(e))return{kind:"syslog-tcp",url:new URL(e.replace(/^syslog\+tcp:/i,"http:"))};if(/^syslog:\/\//i.test(e))return{kind:"syslog",url:new URL(e.replace(/^syslog:/i,"http:"))};if(/^https?:\/\//i.test(e))return{kind:"webhook",url:new URL(e)}}catch{return}}function xt(t,e,n){let a;try{a=t}catch{return}let p=Buffer.from(e,"utf8"),b=(a.protocol==="https:"?It.request:wt.request)(a,{method:"POST",headers:{"content-type":"application/json","content-length":String(p.length)},timeout:n},h=>{h.resume()});b.on("timeout",()=>b.destroy()),b.on("error",()=>{}),b.end(p)}function Kt(t,e){let n=`${Date.now()}000000`;try{let a=JSON.parse(t);if(typeof a.ts=="string"){let p=Date.parse(a.ts);Number.isFinite(p)&&(n=`${p}000000`)}}catch{}return JSON.stringify({resourceLogs:[{resource:{attributes:[{key:"service.name",value:{stringValue:"plaitcode-relay"}},{key:"host.name",value:{stringValue:e}}]},scopeLogs:[{scope:{name:"plaitcode.audit"},logRecords:[{timeUnixNano:n,severityText:"INFO",body:{stringValue:t}}]}]}]})}function Et(t,e={}){let n=e.hostname??"plaitcode-relay";if(t.kind==="webhook")return{send:h=>xt(t.url,h,5e3),close:()=>{}};if(t.kind==="otlp")return{send:h=>xt(t.url,Kt(h,n),5e3),close:()=>{}};let a=t.url.hostname,p=Number(t.url.port||514);if(t.kind==="syslog"){let h=(0,kt.createSocket)("udp4");return h.on("error",()=>{}),h.unref?.(),{send:v=>{let k=`<14>1 - ${n} plaitcode-relay - AUDIT - ${v}`;try{h.send(Buffer.from(k,"utf8"),p,a,()=>{})}catch{}},close:()=>{try{h.close()}catch{}}}}let o,b=()=>(o&&!o.destroyed||(o=(0,St.connect)(p,a,()=>{}),o.on("error",()=>{o=void 0}),o.on("close",()=>{o=void 0}),o.unref?.()),o);return{send:h=>{let v=b();if(v)try{v.write(`<14>1 - ${n} plaitcode-relay - AUDIT - ${h}
`)}catch{o=void 0}},close:()=>{try{o?.destroy()}catch{}}}}var At=require("node:os"),be=require("node:path");async function Vt(){let t=Number(process.env.PLAITCODE_PORT??8787),e=process.env.PLAITCODE_HOST??"127.0.0.1",n=process.env.PLAITCODE_AUDIT??"/var/lib/plaitcode-relay/audit.jsonl",a=process.env.PLAITCODE_AUDIT_STDOUT!=="0",p=process.env.PLAITCODE_IDENTITY?.trim(),o=process.env.PLAITCODE_ADMIN_TOKEN?.trim()??"",b=process.env.PLAITCODE_HISTORY?.trim(),h=b==="-"?void 0:b||(n!=="-"?(0,be.join)((0,be.dirname)(n),"channels"):"/var/lib/plaitcode-relay/channels"),v=p?{state:await lt(p)??et(),path:p}:void 0;v&&(console.log(`[relay] \u8EAB\u4EFD\u6A21\u5F0F\uFF1A${v.state.orgs.length} \u7EC4\u7EC7 / ${v.state.members.length} \u6210\u5458 / ${v.state.devices.length} \u8BBE\u5907`),o||console.log("[relay] \u8B66\u544A\uFF1A\u6CA1\u8BBE PLAITCODE_ADMIN_TOKEN\uFF0C\u7BA1\u7406\u63A5\u53E3\u4E0D\u53EF\u7528"));let k=Ct(process.env.PLAITCODE_AUDIT_SINK),T=k?Et(k,{hostname:(0,At.hostname)()}):void 0;k&&console.log(`[relay] \u5BA1\u8BA1\u5916\u9001\uFF1A${k.kind} \u2192 ${k.url.host}`);let A=process.env.PLAITCODE_FEISHU_APP_ID?.trim()??"",m=process.env.PLAITCODE_FEISHU_APP_SECRET?.trim()??"",D=process.env.PLAITCODE_AUTH_SECRET?.trim()??"",W=(process.env.PLAITCODE_PUBLIC_URL?.trim()||"https://plaitcode.com").replace(/\/+$/,""),ie=A&&m?{appId:A,appSecret:m,redirectUri:`${W}/v1/auth/feishu/callback`,...process.env.PLAITCODE_FEISHU_AUTHORIZE?{endpoints:{authorize:process.env.PLAITCODE_FEISHU_AUTHORIZE}}:{},...process.env.PLAITCODE_FEISHU_TOKEN?{endpoints:{token:process.env.PLAITCODE_FEISHU_TOKEN}}:{},...process.env.PLAITCODE_FEISHU_USERINFO?{endpoints:{userinfo:process.env.PLAITCODE_FEISHU_USERINFO}}:{}}:void 0,j=ie&&D&&v?{config:ie,secret:D,emailDomains:(process.env.PLAITCODE_AUTH_EMAIL_DOMAINS??"").split(",").map(L=>L.trim()).filter(Boolean)}:void 0;j?console.log("[relay] \u98DE\u4E66\u767B\u5F55\u5DF2\u542F\u7528"):A&&console.log("[relay] \u8B66\u544A\uFF1A\u98DE\u4E66\u767B\u5F55\u9700\u8981 PLAITCODE_AUTH_SECRET \u4E0E\u8EAB\u4EFD\u5E93\uFF08PLAITCODE_IDENTITY\uFF09");let te=process.env.PLAITCODE_GITHUB_CLIENT_ID?.trim()??"",Y=process.env.PLAITCODE_GITHUB_CLIENT_SECRET?.trim()??"",Z=te&&Y&&D&&v?{config:{clientId:te,clientSecret:Y,redirectUri:`${W}/v1/auth/github/callback`,...process.env.PLAITCODE_GITHUB_API?.trim()?{apiBase:process.env.PLAITCODE_GITHUB_API.trim()}:{}},secret:D}:void 0;Z?console.log("[relay] GitHub \u767B\u5F55\u5DF2\u542F\u7528"):te&&console.log("[relay] \u8B66\u544A\uFF1AGitHub \u767B\u5F55\u9700\u8981 PLAITCODE_GITHUB_CLIENT_SECRET\u3001PLAITCODE_AUTH_SECRET \u4E0E\u8EAB\u4EFD\u5E93"),process.env.PLAITCODE_FEISHU_WEBHOOK?.trim()&&console.log("[relay] \u98DE\u4E66\u673A\u5668\u4EBA\u901A\u77E5\u5DF2\u542F\u7528");let ne=await yt({port:Number.isFinite(t)&&t>0?t:8787,host:e,log:L=>console.log(L),...v?{identity:v}:{},...o?{adminToken:o}:{},...j?{auth:j}:{},...Z?{github:Z}:{},...h?{historyDir:h}:{},...process.env.PLAITCODE_SELF_ENROLL==="0"?{selfEnroll:!1}:{},...process.env.PLAITCODE_FEISHU_WEBHOOK?.trim()?{notifyHook:process.env.PLAITCODE_FEISHU_WEBHOOK.trim()}:{},audit:{...n&&n!=="-"?{path:n}:{},sink:(L=>{a&&console.log(`[audit] ${L}`),T?.send(L)}),includeIp:process.env.PLAITCODE_AUDIT_IP!=="0",maxBytes:Number(process.env.PLAITCODE_AUDIT_MAX_BYTES??20*1024*1024),keep:Number(process.env.PLAITCODE_AUDIT_KEEP??5)}});console.log(`[relay] ready on http://${e}:${ne.port}`);let _=L=>{console.log(`[relay] ${L}\uFF0C\u6B63\u5728\u5173\u95ED`),T?.close(),ne.close().then(()=>process.exit(0))};process.on("SIGTERM",()=>_("SIGTERM")),process.on("SIGINT",()=>_("SIGINT"))}Vt().catch(t=>{console.error(`[relay] \u542F\u52A8\u5931\u8D25\uFF1A${t instanceof Error?t.message:String(t)}`),process.exit(1)});
