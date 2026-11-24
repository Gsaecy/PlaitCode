"use strict";var O=require("node:crypto"),le=require("node:http");var A=require("node:fs/promises"),J=require("node:path"),_=class{constructor(e={}){this.options=e;this.maxBytes=Math.max(4*1024,e.maxBytes??20*1024*1024),this.keep=Math.max(1,Math.min(e.keep??3,20)),this.includeIp=e.includeIp??!0}options;maxBytes;keep;includeIp;queue=Promise.resolve();written=0;record(e){let n={ts:(this.options.now?.()??new Date).toISOString(),event:e.event,...e.channel?{channel:e.channel}:{},...e.device?{device:e.device}:{},...e.message?{message:e.message}:{},...e.ip&&this.includeIp?{ip:e.ip}:{},...typeof e.bytes=="number"?{bytes:e.bytes}:{},...e.detail?{detail:e.detail}:{}},s=`${JSON.stringify(n)}
`;try{this.options.sink?.(s.trimEnd())}catch{}let o=this.options.path;o&&(this.queue=this.queue.then(()=>this.append(o,s)).catch(()=>{}))}async flush(){await this.queue.catch(()=>{})}async append(e,n){let s=Buffer.byteLength(n);this.written===0&&(this.written=await(0,A.stat)(e).then(o=>o.size).catch(()=>0)),this.written+s>this.maxBytes&&(await this.rotate(e),this.written=0),await(0,A.mkdir)((0,J.dirname)(e),{recursive:!0}).catch(()=>{}),await(0,A.appendFile)(e,n,"utf8"),this.written+=s}async rotate(e){for(let n=this.keep;n>=1;n-=1){let s=n===1?e:`${e}.${n-1}`,o=`${e}.${n}`;await(0,A.rename)(s,o).catch(()=>{})}}};var Y="plaitcode/channel/1:",q="plaitcode/relay/1:",V="plaitcode/enc/1:";function W(t){return`<!doctype html>
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
    border-top:1px solid var(--line); display:flex; gap:8px; align-items:flex-end; }
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
  <span class="meta" id="meta">${t.relayHost.replace(/[<>&"]/g,"")}</span>
</header>
<main id="main"><div class="empty">\u6B63\u5728\u8BFB\u53D6\u9891\u9053\u2026</div></main>
<footer id="footer" style="display:none">
  <textarea id="input" rows="1" placeholder="\u4EE5\u7532\u65B9\u8EAB\u4EFD\u8BF4\u4E00\u53E5\u8BDD\uFF08Enter \u53D1\u9001\uFF09"></textarea>
  <button class="primary" id="send">\u53D1\u9001</button>
</footer>
<script>
(function () {
  var KEY_STORE = 'plaitcode.relay.key';
  var PHASES = { requirement:'\u9700\u6C42', analysis:'\u89E3\u6790', question:'\u8FFD\u95EE', answer:'\u56DE\u590D', confirm:'\u786E\u8BA4', progress:'\u8FDB\u5EA6', result:'\u7ED3\u679C' };
  var main = document.getElementById('main');
  var footer = document.getElementById('footer');
  var input = document.getElementById('input');
  var sendBtn = document.getElementById('send');
  var dot = document.getElementById('dot');
  var meta = document.getElementById('meta');

  var secret = null, keys = null, deviceId = null, since = 0, busy = false, signature = '';

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
    return Promise.all([digest('${Y}'), digest('${q}'), digest('${V}')])
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

  function post(path, body) {
    return fetch(path, {
      method:'POST', credentials:'same-origin',
      headers:{ 'content-type':'application/json', authorization:'Bearer ' + keys.relay },
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
      }
    }).catch(function () {});
  }

  function render(state) {
    dot.className = 'dot' + (state.connected ? ' on' : '');
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
    fetch(url, { credentials:'same-origin', headers:{ authorization:'Bearer ' + keys.relay } })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) throw new Error('\u9891\u9053\u5BC6\u94A5\u4E0D\u5BF9');
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
</html>`}var D=require("node:crypto"),E=require("node:fs/promises"),X=require("node:path"),z=1,ke=100;function Q(){return{version:z,orgs:[],members:[],devices:[]}}function F(t){return`${t}_${(0,D.randomBytes)(9).toString("base64url")}`}function we(){return`pct_${(0,D.randomBytes)(24).toString("base64url")}`}function Z(t){return(0,D.createHash)("sha256").update(t,"utf8").digest("hex")}function Ie(t,e){let n=Buffer.from(t,"utf8"),s=Buffer.from(e,"utf8");return n.length===s.length&&(0,D.timingSafeEqual)(n,s)}var Se={viewer:["poll","presence"],member:["publish","poll","presence"],admin:["publish","poll","presence","manage"],owner:["publish","poll","presence","manage"]};function Ae(t,e){return(Se[t]??[]).includes(e)}function ee(t){return t==="owner"||t==="admin"||t==="member"||t==="viewer"}function te(t,e){let n={id:F("org"),name:e.trim().slice(0,80)||"org",createdAt:Date.now()};return t.orgs.push(n),n}function ne(t,e){if(!t.orgs.some(o=>o.id===e.orgId))return;let n=ee(e.role)?e.role:"member",s={id:F("mem"),orgId:e.orgId,name:e.name.trim().slice(0,80)||"member",role:n,createdAt:Date.now()};return t.members.push(s),s}function re(t,e){let n=t.members.find(u=>u.id===e.memberId);if(!n)return;let s=we(),o=e.channels.filter(u=>typeof u.channelId=="string"&&u.channelId.trim().length>0).slice(0,ke).map(u=>({channelId:u.channelId.trim().slice(0,64),role:ee(u.role)?u.role:n.role})),d={id:F("dev"),memberId:n.id,name:e.name.trim().slice(0,80)||"device",platform:(e.platform??"unknown").slice(0,20),tokenHash:Z(s),grants:o,createdAt:Date.now()};return t.devices.push(d),{device:d,token:s}}function ie(t,e){let n=t.devices.find(s=>s.id===e);return!n||n.revokedAt?!1:(n.revokedAt=Date.now(),!0)}function Ee(t,e){if(!e.startsWith("pct_"))return;let n=Z(e);return t.devices.find(s=>Ie(s.tokenHash,n))}function oe(t,e,n,s){let o=Ee(t,e);if(!o)return{ok:!1,reason:"\u8BBE\u5907\u4EE4\u724C\u65E0\u6548"};if(o.revokedAt)return{ok:!1,device:o,reason:"\u8BBE\u5907\u5DF2\u88AB\u540A\u9500"};let d=t.members.find(f=>f.id===o.memberId);if(!d)return{ok:!1,device:o,reason:"\u8BBE\u5907\u6240\u5C5E\u6210\u5458\u5DF2\u4E0D\u5B58\u5728"};let u=o.grants.find(f=>f.channelId===n);return u?Ae(u.role,s)?(o.lastSeenAt=Date.now(),{ok:!0,device:o,member:d}):{ok:!1,device:o,member:d,reason:`\u89D2\u8272 ${u.role} \u4E0D\u80FD\u6267\u884C ${s}`}:{ok:!1,device:o,member:d,reason:"\u8FD9\u53F0\u8BBE\u5907\u6CA1\u6709\u8BE5\u9891\u9053\u7684\u6388\u6743"}}async function ae(t,e){await(0,E.mkdir)((0,X.dirname)(t),{recursive:!0}).catch(()=>{});let n=`${t}.tmp`;await(0,E.writeFile)(n,`${JSON.stringify(e,null,2)}
`,"utf8"),await(0,E.rename)(n,t)}async function se(t){try{let e=await(0,E.readFile)(t,"utf8"),n=JSON.parse(e);return n.version!==z||!Array.isArray(n.orgs)||!Array.isArray(n.members)||!Array.isArray(n.devices)?void 0:{version:z,orgs:n.orgs,members:n.members,devices:n.devices}}catch{return}}function de(t){return{version:t.version,orgs:t.orgs,members:t.members,devices:t.devices.map(e=>({id:e.id,memberId:e.memberId,name:e.name,platform:e.platform,grants:e.grants,createdAt:e.createdAt,lastSeenAt:e.lastSeenAt,revokedAt:e.revokedAt}))}}var Te="1",Re=96*1024,De=9e4;function ce(t){return(0,O.createHash)("sha256").update(t,"utf8").digest("hex")}function l(t,e,n,s={}){let o=JSON.stringify(n);t.writeHead(e,{"content-type":"application/json; charset=utf-8","content-length":Buffer.byteLength(o),"cache-control":"no-store","x-content-type-options":"nosniff",...s}),t.end(o)}function K(t){return new Promise(e=>{let n=[],s=0;t.on("data",o=>{if(s+=o.length,s>Re){e(void 0),t.destroy();return}n.push(o)}),t.on("end",()=>e(Buffer.concat(n).toString("utf8"))),t.on("error",()=>e(void 0))})}function M(t){let e=t.headers.authorization??"";return/^Bearer\s+(.+)$/i.exec(e.trim())?.[1]?.trim()??""}function w(t){let e=t.headers["x-real-ip"];if(typeof e=="string"&&e.trim())return e.trim();let n=t.headers["x-forwarded-for"];return typeof n=="string"&&n.trim()?n.split(",")[0].trim():(t.socket.remoteAddress??"").replace(/^::ffff:/,"")}async function ue(t={}){let e=Math.max(20,t.maxMessages??500),n=Math.max(1e3,Math.min(t.maxWaitMs??22e3,25e3)),s=Math.max(10,t.rateLimit??240),o=t.log??(()=>{}),d=new _(t.audit),u=new Map,f=new Map,I=(r,i)=>{let m=u.get(r);if(m)return m.keyHash===ce(i)?m:void 0;if(!/^[0-9a-f]{16,64}$/.test(r))return;let g={keyHash:ce(i),createdAt:Date.now(),seq:0,messages:[],waiters:[],seen:new Set,presence:new Map};return u.set(r,g),o(`[relay] \u65B0\u9891\u9053 ${r.slice(0,8)}\u2026`),g},C=r=>{let i=Date.now(),m=f.get(r);return!m||i>=m.resetAt?(f.set(r,{count:1,resetAt:i+6e4}),!0):(m.count+=1,m.count<=s)},x=t.identity,S=t.adminToken??"",L=r=>{if(!/^[0-9a-f]{16,64}$/.test(r))return;let i=u.get(r);if(i)return i;let m={keyHash:"",createdAt:Date.now(),seq:0,messages:[],waiters:[],seen:new Set,presence:new Map};return u.set(r,m),o(`[relay] \u65B0\u9891\u9053 ${r.slice(0,8)}\u2026\uFF08\u8EAB\u4EFD\u6A21\u5F0F\uFF09`),m},H=(r,i,m)=>{if(!x)return{ok:!0};let g=oe(x.state,r,i,m);return g.ok?{ok:!0,deviceId:g.device?.id,member:g.member?.name}:{ok:!1,reason:g.reason??"\u672A\u6388\u6743"}},B=async()=>{x?.path&&await ae(x.path,x.state).catch(r=>{o(`[relay] \u8EAB\u4EFD\u5E93\u5199\u5165\u5931\u8D25\uFF1A${r instanceof Error?r.message:String(r)}`)})},xe=r=>{if(!S||typeof r!="string")return!1;let i=(0,O.createHash)("sha256").update(r).digest(),m=(0,O.createHash)("sha256").update(S).digest();return i.length===m.length&&(0,O.timingSafeEqual)(i,m)},P=(0,le.createServer)((r,i)=>{(async()=>{let m=r.url??"/",g=m.split("?")[0]??"/",N=new URLSearchParams(m.slice(m.indexOf("?")+1)),G=g==="/health"||g==="/";if(!(G||g==="/m")){let h=w(r);if(!C(h)){d.record({event:"denied",ip:h,detail:"rate limited"}),l(i,429,{ok:!1,error:"too many requests"});return}}if(r.method==="GET"&&g==="/m"){let h=W({relayHost:typeof r.headers.host=="string"?r.headers.host:"plaitcode.com"});i.writeHead(200,{"content-type":"text/html; charset=utf-8","content-length":Buffer.byteLength(h),"cache-control":"no-store","x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"no-referrer"}),i.end(h);return}if(g.startsWith("/v1/admin/")){if(!x||!S){l(i,404,{ok:!1,error:"admin api disabled"});return}if(!xe(r.headers["x-plaitcode-admin"])){d.record({event:"denied",ip:w(r),detail:"admin auth failed"}),l(i,403,{ok:!1,error:"admin denied"});return}let h=r.method==="POST"?await K(r):"";if(h===void 0){l(i,413,{ok:!1,error:"body too large"});return}let c={};if(h)try{c=JSON.parse(h)}catch{l(i,400,{ok:!1,error:"invalid json"});return}if(g==="/v1/admin/state"&&r.method==="GET"){l(i,200,{ok:!0,identity:de(x.state)});return}if(g==="/v1/admin/orgs"&&r.method==="POST"){let a=te(x.state,String(c.name??""));await B(),d.record({event:"admin",ip:w(r),detail:`org ${a.name}`}),l(i,200,{ok:!0,org:a});return}if(g==="/v1/admin/members"&&r.method==="POST"){let a=ne(x.state,{orgId:String(c.orgId??""),name:String(c.name??""),role:c.role});if(!a){l(i,404,{ok:!1,error:"org not found"});return}await B(),d.record({event:"admin",ip:w(r),detail:`member ${a.name} (${a.role})`}),l(i,200,{ok:!0,member:a});return}if(g==="/v1/admin/devices"&&r.method==="POST"){let a=Array.isArray(c.channels)?c.channels:[],p=re(x.state,{memberId:String(c.memberId??""),name:String(c.name??""),platform:typeof c.platform=="string"?c.platform:void 0,channels:a.filter(y=>!!y&&typeof y=="object").map(y=>({channelId:String(y.channelId??""),role:y.role}))});if(!p){l(i,404,{ok:!1,error:"member not found"});return}await B(),d.record({event:"admin",ip:w(r),detail:`device ${p.device.name} for ${p.device.memberId}`}),l(i,200,{ok:!0,device:{id:p.device.id,memberId:p.device.memberId,name:p.device.name,grants:p.device.grants},token:p.token});return}if(g==="/v1/admin/devices/revoke"&&r.method==="POST"){let a=ie(x.state,String(c.deviceId??""));await B(),d.record({event:"admin",ip:w(r),detail:`revoke ${String(c.deviceId??"")} -> ${a}`}),l(i,a?200:404,{ok:a});return}l(i,404,{ok:!1,error:"not found"});return}if(r.method==="GET"&&G){l(i,200,{ok:!0,service:"plaitcode-relay",version:Te,channels:u.size,uptime:Math.round(process.uptime())});return}if(!g.startsWith("/v1/")){l(i,404,{ok:!1,error:"not found"});return}if(r.method==="GET"&&g==="/v1/poll"){let h=N.get("channel")??"",c=H(M(r),h,"poll");if(!c.ok){d.record({event:"denied",channel:h.slice(0,32),ip:w(r),detail:c.reason}),l(i,403,{ok:!1,error:c.reason});return}let a=x?L(h):I(h,M(r));if(!a){l(i,403,{ok:!1,error:"channel denied"});return}let p=Number(N.get("since")??0)||0,y=Math.min(Math.max(Number(N.get("wait")??20)*1e3||2e4,0),n),T=()=>a.messages.filter(R=>R.seq>p),b=T();if(b.length||y===0){l(i,200,{ok:!0,messages:b.slice(-200),seq:a.seq});return}let k=!1,v=()=>{if(k)return;k=!0;let R=a.waiters.indexOf(v);R>=0&&a.waiters.splice(R,1),clearTimeout($),!i.writableEnded&&l(i,200,{ok:!0,messages:T().slice(-200),seq:a.seq})},$=setTimeout(v,y);$.unref?.(),a.waiters.push(v),r.on("close",()=>{if(k)return;k=!0;let R=a.waiters.indexOf(v);R>=0&&a.waiters.splice(R,1),clearTimeout($)});return}if(r.method==="POST"&&g==="/v1/publish"){let h=await K(r);if(!h){l(i,413,{ok:!1,error:"body too large"});return}let c;try{c=JSON.parse(h)}catch{l(i,400,{ok:!1,error:"invalid json"});return}let a=typeof c.channel=="string"?c.channel:"",p=typeof c.id=="string"?c.id.slice(0,80):"",y=typeof c.from=="string"?c.from.slice(0,80):"",T=typeof c.envelope?.iv=="string"?c.envelope.iv:"",b=typeof c.envelope?.ct=="string"?c.envelope.ct:"";if(!p||!y||!T||!b||b.length>64*1024){l(i,400,{ok:!1,error:"invalid message"});return}let k=H(M(r),a,"publish");if(!k.ok){d.record({event:"denied",channel:a.slice(0,32),ip:w(r),detail:k.reason}),l(i,403,{ok:!1,error:k.reason});return}let v=x?L(a):I(a,M(r));if(!v){d.record({event:"denied",channel:a.slice(0,32),ip:w(r),detail:"channel denied"}),l(i,403,{ok:!1,error:"channel denied"});return}if(v.seen.has(p)){d.record({event:"publish",channel:a,device:y,message:p,ip:w(r),detail:"duplicate"}),l(i,200,{ok:!0,duplicate:!0,seq:v.seq});return}v.seq+=1,v.seen.add(p),d.record({event:"publish",channel:a,device:y,message:p,ip:w(r),bytes:b.length}),v.seen.size>e*4&&(v.seen=new Set([...v.seen].slice(-e*2))),v.messages.push({seq:v.seq,id:p,from:y,envelope:{iv:T,ct:b},at:Date.now()}),v.messages.length>e&&(v.messages=v.messages.slice(-e));for(let $ of[...v.waiters])$();l(i,200,{ok:!0,seq:v.seq});return}if(g==="/v1/presence"){let h=M(r),c=N.get("channel")??"",a;if(r.method==="POST"){let b=await K(r);if(!b){l(i,413,{ok:!1,error:"body too large"});return}let k;try{k=JSON.parse(b)}catch{l(i,400,{ok:!1,error:"invalid json"});return}c=typeof k.channel=="string"?k.channel:"",a=k.device}let p=H(h,c,"presence");if(!p.ok){d.record({event:"denied",channel:c.slice(0,32),ip:w(r),detail:p.reason}),l(i,403,{ok:!1,error:p.reason});return}let y=x?L(c):I(c,h);if(!y){l(i,403,{ok:!1,error:"channel denied"});return}if(a){let b=p.deviceId??(typeof a.id=="string"?a.id.slice(0,80):"");if(!b){l(i,400,{ok:!1,error:"invalid device"});return}y.presence.set(b,{name:p.member?`${p.member} \xB7 ${typeof a.name=="string"?a.name.slice(0,60):"\u8BBE\u5907"}`:typeof a.name=="string"?a.name.slice(0,120):b,platform:typeof a.platform=="string"?a.platform:"unknown",project:typeof a.project=="string"?a.project.slice(0,120):"",at:Date.now()})}let T=Date.now();for(let[b,k]of y.presence)T-k.at>De&&y.presence.delete(b);l(i,200,{ok:!0,devices:[...y.presence.entries()].map(([b,k])=>({id:b,...k}))});return}l(i,404,{ok:!1,error:"not found"})})().catch(m=>{o(`[relay] \u8BF7\u6C42\u5904\u7406\u5931\u8D25\uFF1A${m instanceof Error?m.message:String(m)}`),i.writableEnded||l(i,500,{ok:!1,error:"internal error"})})});await new Promise((r,i)=>{P.once("error",i),P.listen(t.port??8787,t.host??"0.0.0.0",()=>{P.off("error",i),r()})});let j=P.address(),U=j&&typeof j=="object"?j.port:t.port??8787;return o(`[relay] \u76D1\u542C ${t.host??"0.0.0.0"}:${U}`),d.record({event:"startup",detail:`listen ${t.host??"0.0.0.0"}:${U}`}),{port:U,close:()=>new Promise(r=>{d.record({event:"shutdown"});for(let i of u.values())for(let m of[...i.waiters])m();P.close(()=>{d.flush().then(()=>r())}),setTimeout(()=>r(),1500).unref?.()})}}var fe=require("node:dgram"),pe=require("node:http"),ge=require("node:https"),he=require("node:net");function ve(t){let e=(t??"").trim();if(e)try{if(/^otlp\+https?:\/\//i.test(e))return{kind:"otlp",url:new URL(e.replace(/^otlp\+/i,""))};if(/^syslog\+tcp:\/\//i.test(e))return{kind:"syslog-tcp",url:new URL(e.replace(/^syslog\+tcp:/i,"http:"))};if(/^syslog:\/\//i.test(e))return{kind:"syslog",url:new URL(e.replace(/^syslog:/i,"http:"))};if(/^https?:\/\//i.test(e))return{kind:"webhook",url:new URL(e)}}catch{return}}function me(t,e,n){let s;try{s=t}catch{return}let o=Buffer.from(e,"utf8"),u=(s.protocol==="https:"?ge.request:pe.request)(s,{method:"POST",headers:{"content-type":"application/json","content-length":String(o.length)},timeout:n},f=>{f.resume()});u.on("timeout",()=>u.destroy()),u.on("error",()=>{}),u.end(o)}function Ce(t,e){let n=`${Date.now()}000000`;try{let s=JSON.parse(t);if(typeof s.ts=="string"){let o=Date.parse(s.ts);Number.isFinite(o)&&(n=`${o}000000`)}}catch{}return JSON.stringify({resourceLogs:[{resource:{attributes:[{key:"service.name",value:{stringValue:"plaitcode-relay"}},{key:"host.name",value:{stringValue:e}}]},scopeLogs:[{scope:{name:"plaitcode.audit"},logRecords:[{timeUnixNano:n,severityText:"INFO",body:{stringValue:t}}]}]}]})}function ye(t,e={}){let n=e.hostname??"plaitcode-relay";if(t.kind==="webhook")return{send:f=>me(t.url,f,5e3),close:()=>{}};if(t.kind==="otlp")return{send:f=>me(t.url,Ce(f,n),5e3),close:()=>{}};let s=t.url.hostname,o=Number(t.url.port||514);if(t.kind==="syslog"){let f=(0,fe.createSocket)("udp4");return f.on("error",()=>{}),f.unref?.(),{send:I=>{let C=`<14>1 - ${n} plaitcode-relay - AUDIT - ${I}`;try{f.send(Buffer.from(C,"utf8"),o,s,()=>{})}catch{}},close:()=>{try{f.close()}catch{}}}}let d,u=()=>(d&&!d.destroyed||(d=(0,he.connect)(o,s,()=>{}),d.on("error",()=>{d=void 0}),d.on("close",()=>{d=void 0}),d.unref?.()),d);return{send:f=>{let I=u();if(I)try{I.write(`<14>1 - ${n} plaitcode-relay - AUDIT - ${f}
`)}catch{d=void 0}},close:()=>{try{d?.destroy()}catch{}}}}var be=require("node:os");async function Oe(){let t=Number(process.env.PLAITCODE_PORT??8787),e=process.env.PLAITCODE_HOST??"127.0.0.1",n=process.env.PLAITCODE_AUDIT??"/var/lib/plaitcode-relay/audit.jsonl",s=process.env.PLAITCODE_AUDIT_STDOUT!=="0",o=process.env.PLAITCODE_IDENTITY?.trim(),d=process.env.PLAITCODE_ADMIN_TOKEN?.trim()??"",u=o?{state:await se(o)??Q(),path:o}:void 0;u&&(console.log(`[relay] \u8EAB\u4EFD\u6A21\u5F0F\uFF1A${u.state.orgs.length} \u7EC4\u7EC7 / ${u.state.members.length} \u6210\u5458 / ${u.state.devices.length} \u8BBE\u5907`),d||console.log("[relay] \u8B66\u544A\uFF1A\u6CA1\u8BBE PLAITCODE_ADMIN_TOKEN\uFF0C\u7BA1\u7406\u63A5\u53E3\u4E0D\u53EF\u7528"));let f=ve(process.env.PLAITCODE_AUDIT_SINK),I=f?ye(f,{hostname:(0,be.hostname)()}):void 0;f&&console.log(`[relay] \u5BA1\u8BA1\u5916\u9001\uFF1A${f.kind} \u2192 ${f.url.host}`);let C=await ue({port:Number.isFinite(t)&&t>0?t:8787,host:e,log:S=>console.log(S),...u?{identity:u}:{},...d?{adminToken:d}:{},audit:{...n&&n!=="-"?{path:n}:{},sink:(S=>{s&&console.log(`[audit] ${S}`),I?.send(S)}),includeIp:process.env.PLAITCODE_AUDIT_IP!=="0",maxBytes:Number(process.env.PLAITCODE_AUDIT_MAX_BYTES??20*1024*1024),keep:Number(process.env.PLAITCODE_AUDIT_KEEP??5)}});console.log(`[relay] ready on http://${e}:${C.port}`);let x=S=>{console.log(`[relay] ${S}\uFF0C\u6B63\u5728\u5173\u95ED`),I?.close(),C.close().then(()=>process.exit(0))};process.on("SIGTERM",()=>x("SIGTERM")),process.on("SIGINT",()=>x("SIGINT"))}Oe().catch(t=>{console.error(`[relay] \u542F\u52A8\u5931\u8D25\uFF1A${t instanceof Error?t.message:String(t)}`),process.exit(1)});
