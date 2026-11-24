"use strict";var P=require("node:crypto"),le=require("node:http");var I=require("node:fs/promises"),Y=require("node:path"),_=class{constructor(e={}){this.options=e;this.maxBytes=Math.max(4*1024,e.maxBytes??20*1024*1024),this.keep=Math.max(1,Math.min(e.keep??3,20)),this.includeIp=e.includeIp??!0}options;maxBytes;keep;includeIp;queue=Promise.resolve();written=0;record(e){let r={ts:(this.options.now?.()??new Date).toISOString(),event:e.event,...e.channel?{channel:e.channel}:{},...e.device?{device:e.device}:{},...e.message?{message:e.message}:{},...e.ip&&this.includeIp?{ip:e.ip}:{},...typeof e.bytes=="number"?{bytes:e.bytes}:{},...e.detail?{detail:e.detail}:{}},c=`${JSON.stringify(r)}
`;try{this.options.sink?.(c.trimEnd())}catch{}let o=this.options.path;o&&(this.queue=this.queue.then(()=>this.append(o,c)).catch(()=>{}))}async flush(){await this.queue.catch(()=>{})}async append(e,r){let c=Buffer.byteLength(r);this.written===0&&(this.written=await(0,I.stat)(e).then(o=>o.size).catch(()=>0)),this.written+c>this.maxBytes&&(await this.rotate(e),this.written=0),await(0,I.mkdir)((0,Y.dirname)(e),{recursive:!0}).catch(()=>{}),await(0,I.appendFile)(e,r,"utf8"),this.written+=c}async rotate(e){for(let r=this.keep;r>=1;r-=1){let c=r===1?e:`${e}.${r-1}`,o=`${e}.${r}`;await(0,I.rename)(c,o).catch(()=>{})}}};var J="plaitcode/channel/1:",W="plaitcode/relay/1:",X="plaitcode/enc/1:";function q(t){return`<!doctype html>
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
    return Promise.all([digest('${J}'), digest('${W}'), digest('${X}')])
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
</html>`}var C=require("node:crypto"),S=require("node:fs/promises"),V=require("node:path"),U=1,fe=100;function Q(){return{version:U,orgs:[],members:[],devices:[]}}function F(t){return`${t}_${(0,C.randomBytes)(9).toString("base64url")}`}function pe(){return`pct_${(0,C.randomBytes)(24).toString("base64url")}`}function Z(t){return(0,C.createHash)("sha256").update(t,"utf8").digest("hex")}function ge(t,e){let r=Buffer.from(t,"utf8"),c=Buffer.from(e,"utf8");return r.length===c.length&&(0,C.timingSafeEqual)(r,c)}var he={viewer:["poll","presence"],member:["publish","poll","presence"],admin:["publish","poll","presence","manage"],owner:["publish","poll","presence","manage"]};function ve(t,e){return(he[t]??[]).includes(e)}function ee(t){return t==="owner"||t==="admin"||t==="member"||t==="viewer"}function te(t,e){let r={id:F("org"),name:e.trim().slice(0,80)||"org",createdAt:Date.now()};return t.orgs.push(r),r}function ne(t,e){if(!t.orgs.some(o=>o.id===e.orgId))return;let r=ee(e.role)?e.role:"member",c={id:F("mem"),orgId:e.orgId,name:e.name.trim().slice(0,80)||"member",role:r,createdAt:Date.now()};return t.members.push(c),c}function re(t,e){let r=t.members.find(u=>u.id===e.memberId);if(!r)return;let c=pe(),o=e.channels.filter(u=>typeof u.channelId=="string"&&u.channelId.trim().length>0).slice(0,fe).map(u=>({channelId:u.channelId.trim().slice(0,64),role:ee(u.role)?u.role:r.role})),l={id:F("dev"),memberId:r.id,name:e.name.trim().slice(0,80)||"device",platform:(e.platform??"unknown").slice(0,20),tokenHash:Z(c),grants:o,createdAt:Date.now()};return t.devices.push(l),{device:l,token:c}}function ie(t,e){let r=t.devices.find(c=>c.id===e);return!r||r.revokedAt?!1:(r.revokedAt=Date.now(),!0)}function ye(t,e){if(!e.startsWith("pct_"))return;let r=Z(e);return t.devices.find(c=>ge(c.tokenHash,r))}function ae(t,e,r,c){let o=ye(t,e);if(!o)return{ok:!1,reason:"\u8BBE\u5907\u4EE4\u724C\u65E0\u6548"};if(o.revokedAt)return{ok:!1,device:o,reason:"\u8BBE\u5907\u5DF2\u88AB\u540A\u9500"};let l=t.members.find(k=>k.id===o.memberId);if(!l)return{ok:!1,device:o,reason:"\u8BBE\u5907\u6240\u5C5E\u6210\u5458\u5DF2\u4E0D\u5B58\u5728"};let u=o.grants.find(k=>k.channelId===r);return u?ve(u.role,c)?(o.lastSeenAt=Date.now(),{ok:!0,device:o,member:l}):{ok:!1,device:o,member:l,reason:`\u89D2\u8272 ${u.role} \u4E0D\u80FD\u6267\u884C ${c}`}:{ok:!1,device:o,member:l,reason:"\u8FD9\u53F0\u8BBE\u5907\u6CA1\u6709\u8BE5\u9891\u9053\u7684\u6388\u6743"}}async function oe(t,e){await(0,S.mkdir)((0,V.dirname)(t),{recursive:!0}).catch(()=>{});let r=`${t}.tmp`;await(0,S.writeFile)(r,`${JSON.stringify(e,null,2)}
`,"utf8"),await(0,S.rename)(r,t)}async function se(t){try{let e=await(0,S.readFile)(t,"utf8"),r=JSON.parse(e);return r.version!==U||!Array.isArray(r.orgs)||!Array.isArray(r.members)||!Array.isArray(r.devices)?void 0:{version:U,orgs:r.orgs,members:r.members,devices:r.devices}}catch{return}}function de(t){return{version:t.version,orgs:t.orgs,members:t.members,devices:t.devices.map(e=>({id:e.id,memberId:e.memberId,name:e.name,platform:e.platform,grants:e.grants,createdAt:e.createdAt,lastSeenAt:e.lastSeenAt,revokedAt:e.revokedAt}))}}var be="1",xe=96*1024,we=9e4;function ce(t){return(0,P.createHash)("sha256").update(t,"utf8").digest("hex")}function d(t,e,r,c={}){let o=JSON.stringify(r);t.writeHead(e,{"content-type":"application/json; charset=utf-8","content-length":Buffer.byteLength(o),"cache-control":"no-store","x-content-type-options":"nosniff",...c}),t.end(o)}function K(t){return new Promise(e=>{let r=[],c=0;t.on("data",o=>{if(c+=o.length,c>xe){e(void 0),t.destroy();return}r.push(o)}),t.on("end",()=>e(Buffer.concat(r).toString("utf8"))),t.on("error",()=>e(void 0))})}function R(t){let e=t.headers.authorization??"";return/^Bearer\s+(.+)$/i.exec(e.trim())?.[1]?.trim()??""}function w(t){let e=t.headers["x-real-ip"];if(typeof e=="string"&&e.trim())return e.trim();let r=t.headers["x-forwarded-for"];return typeof r=="string"&&r.trim()?r.split(",")[0].trim():(t.socket.remoteAddress??"").replace(/^::ffff:/,"")}async function ue(t={}){let e=Math.max(20,t.maxMessages??500),r=Math.max(1e3,Math.min(t.maxWaitMs??22e3,25e3)),c=Math.max(10,t.rateLimit??240),o=t.log??(()=>{}),l=new _(t.audit),u=new Map,k=new Map,D=(n,i)=>{let m=u.get(n);if(m)return m.keyHash===ce(i)?m:void 0;if(!/^[0-9a-f]{16,64}$/.test(n))return;let p={keyHash:ce(i),createdAt:Date.now(),seq:0,messages:[],waiters:[],seen:new Set,presence:new Map};return u.set(n,p),o(`[relay] \u65B0\u9891\u9053 ${n.slice(0,8)}\u2026`),p},A=n=>{let i=Date.now(),m=k.get(n);return!m||i>=m.resetAt?(k.set(n,{count:1,resetAt:i+6e4}),!0):(m.count+=1,m.count<=c)},x=t.identity,N=t.adminToken??"",H=n=>{if(!/^[0-9a-f]{16,64}$/.test(n))return;let i=u.get(n);if(i)return i;let m={keyHash:"",createdAt:Date.now(),seq:0,messages:[],waiters:[],seen:new Set,presence:new Map};return u.set(n,m),o(`[relay] \u65B0\u9891\u9053 ${n.slice(0,8)}\u2026\uFF08\u8EAB\u4EFD\u6A21\u5F0F\uFF09`),m},L=(n,i,m)=>{if(!x)return{ok:!0};let p=ae(x.state,n,i,m);return p.ok?{ok:!0,deviceId:p.device?.id,member:p.member?.name}:{ok:!1,reason:p.reason??"\u672A\u6388\u6743"}},$=async()=>{x?.path&&await oe(x.path,x.state).catch(n=>{o(`[relay] \u8EAB\u4EFD\u5E93\u5199\u5165\u5931\u8D25\uFF1A${n instanceof Error?n.message:String(n)}`)})},me=n=>{if(!N||typeof n!="string")return!1;let i=(0,P.createHash)("sha256").update(n).digest(),m=(0,P.createHash)("sha256").update(N).digest();return i.length===m.length&&(0,P.timingSafeEqual)(i,m)},M=(0,le.createServer)((n,i)=>{(async()=>{let m=n.url??"/",p=m.split("?")[0]??"/",B=new URLSearchParams(m.slice(m.indexOf("?")+1)),G=p==="/health"||p==="/";if(!(G||p==="/m")){let g=w(n);if(!A(g)){l.record({event:"denied",ip:g,detail:"rate limited"}),d(i,429,{ok:!1,error:"too many requests"});return}}if(n.method==="GET"&&p==="/m"){let g=q({relayHost:typeof n.headers.host=="string"?n.headers.host:"plaitcode.com"});i.writeHead(200,{"content-type":"text/html; charset=utf-8","content-length":Buffer.byteLength(g),"cache-control":"no-store","x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"no-referrer"}),i.end(g);return}if(p.startsWith("/v1/admin/")){if(!x||!N){d(i,404,{ok:!1,error:"admin api disabled"});return}if(!me(n.headers["x-plaitcode-admin"])){l.record({event:"denied",ip:w(n),detail:"admin auth failed"}),d(i,403,{ok:!1,error:"admin denied"});return}let g=n.method==="POST"?await K(n):"";if(g===void 0){d(i,413,{ok:!1,error:"body too large"});return}let s={};if(g)try{s=JSON.parse(g)}catch{d(i,400,{ok:!1,error:"invalid json"});return}if(p==="/v1/admin/state"&&n.method==="GET"){d(i,200,{ok:!0,identity:de(x.state)});return}if(p==="/v1/admin/orgs"&&n.method==="POST"){let a=te(x.state,String(s.name??""));await $(),l.record({event:"admin",ip:w(n),detail:`org ${a.name}`}),d(i,200,{ok:!0,org:a});return}if(p==="/v1/admin/members"&&n.method==="POST"){let a=ne(x.state,{orgId:String(s.orgId??""),name:String(s.name??""),role:s.role});if(!a){d(i,404,{ok:!1,error:"org not found"});return}await $(),l.record({event:"admin",ip:w(n),detail:`member ${a.name} (${a.role})`}),d(i,200,{ok:!0,member:a});return}if(p==="/v1/admin/devices"&&n.method==="POST"){let a=Array.isArray(s.channels)?s.channels:[],f=re(x.state,{memberId:String(s.memberId??""),name:String(s.name??""),platform:typeof s.platform=="string"?s.platform:void 0,channels:a.filter(v=>!!v&&typeof v=="object").map(v=>({channelId:String(v.channelId??""),role:v.role}))});if(!f){d(i,404,{ok:!1,error:"member not found"});return}await $(),l.record({event:"admin",ip:w(n),detail:`device ${f.device.name} for ${f.device.memberId}`}),d(i,200,{ok:!0,device:{id:f.device.id,memberId:f.device.memberId,name:f.device.name,grants:f.device.grants},token:f.token});return}if(p==="/v1/admin/devices/revoke"&&n.method==="POST"){let a=ie(x.state,String(s.deviceId??""));await $(),l.record({event:"admin",ip:w(n),detail:`revoke ${String(s.deviceId??"")} -> ${a}`}),d(i,a?200:404,{ok:a});return}d(i,404,{ok:!1,error:"not found"});return}if(n.method==="GET"&&G){d(i,200,{ok:!0,service:"plaitcode-relay",version:be,channels:u.size,uptime:Math.round(process.uptime())});return}if(!p.startsWith("/v1/")){d(i,404,{ok:!1,error:"not found"});return}if(n.method==="GET"&&p==="/v1/poll"){let g=B.get("channel")??"",s=L(R(n),g,"poll");if(!s.ok){l.record({event:"denied",channel:g.slice(0,32),ip:w(n),detail:s.reason}),d(i,403,{ok:!1,error:s.reason});return}let a=x?H(g):D(g,R(n));if(!a){d(i,403,{ok:!1,error:"channel denied"});return}let f=Number(B.get("since")??0)||0,v=Math.min(Math.max(Number(B.get("wait")??20)*1e3||2e4,0),r),E=()=>a.messages.filter(T=>T.seq>f),y=E();if(y.length||v===0){d(i,200,{ok:!0,messages:y.slice(-200),seq:a.seq});return}let b=!1,h=()=>{if(b)return;b=!0;let T=a.waiters.indexOf(h);T>=0&&a.waiters.splice(T,1),clearTimeout(O),!i.writableEnded&&d(i,200,{ok:!0,messages:E().slice(-200),seq:a.seq})},O=setTimeout(h,v);O.unref?.(),a.waiters.push(h),n.on("close",()=>{if(b)return;b=!0;let T=a.waiters.indexOf(h);T>=0&&a.waiters.splice(T,1),clearTimeout(O)});return}if(n.method==="POST"&&p==="/v1/publish"){let g=await K(n);if(!g){d(i,413,{ok:!1,error:"body too large"});return}let s;try{s=JSON.parse(g)}catch{d(i,400,{ok:!1,error:"invalid json"});return}let a=typeof s.channel=="string"?s.channel:"",f=typeof s.id=="string"?s.id.slice(0,80):"",v=typeof s.from=="string"?s.from.slice(0,80):"",E=typeof s.envelope?.iv=="string"?s.envelope.iv:"",y=typeof s.envelope?.ct=="string"?s.envelope.ct:"";if(!f||!v||!E||!y||y.length>64*1024){d(i,400,{ok:!1,error:"invalid message"});return}let b=L(R(n),a,"publish");if(!b.ok){l.record({event:"denied",channel:a.slice(0,32),ip:w(n),detail:b.reason}),d(i,403,{ok:!1,error:b.reason});return}let h=x?H(a):D(a,R(n));if(!h){l.record({event:"denied",channel:a.slice(0,32),ip:w(n),detail:"channel denied"}),d(i,403,{ok:!1,error:"channel denied"});return}if(h.seen.has(f)){l.record({event:"publish",channel:a,device:v,message:f,ip:w(n),detail:"duplicate"}),d(i,200,{ok:!0,duplicate:!0,seq:h.seq});return}h.seq+=1,h.seen.add(f),l.record({event:"publish",channel:a,device:v,message:f,ip:w(n),bytes:y.length}),h.seen.size>e*4&&(h.seen=new Set([...h.seen].slice(-e*2))),h.messages.push({seq:h.seq,id:f,from:v,envelope:{iv:E,ct:y},at:Date.now()}),h.messages.length>e&&(h.messages=h.messages.slice(-e));for(let O of[...h.waiters])O();d(i,200,{ok:!0,seq:h.seq});return}if(p==="/v1/presence"){let g=R(n),s=B.get("channel")??"",a;if(n.method==="POST"){let y=await K(n);if(!y){d(i,413,{ok:!1,error:"body too large"});return}let b;try{b=JSON.parse(y)}catch{d(i,400,{ok:!1,error:"invalid json"});return}s=typeof b.channel=="string"?b.channel:"",a=b.device}let f=L(g,s,"presence");if(!f.ok){l.record({event:"denied",channel:s.slice(0,32),ip:w(n),detail:f.reason}),d(i,403,{ok:!1,error:f.reason});return}let v=x?H(s):D(s,g);if(!v){d(i,403,{ok:!1,error:"channel denied"});return}if(a){let y=f.deviceId??(typeof a.id=="string"?a.id.slice(0,80):"");if(!y){d(i,400,{ok:!1,error:"invalid device"});return}v.presence.set(y,{name:f.member?`${f.member} \xB7 ${typeof a.name=="string"?a.name.slice(0,60):"\u8BBE\u5907"}`:typeof a.name=="string"?a.name.slice(0,120):y,platform:typeof a.platform=="string"?a.platform:"unknown",project:typeof a.project=="string"?a.project.slice(0,120):"",at:Date.now()})}let E=Date.now();for(let[y,b]of v.presence)E-b.at>we&&v.presence.delete(y);d(i,200,{ok:!0,devices:[...v.presence.entries()].map(([y,b])=>({id:y,...b}))});return}d(i,404,{ok:!1,error:"not found"})})().catch(m=>{o(`[relay] \u8BF7\u6C42\u5904\u7406\u5931\u8D25\uFF1A${m instanceof Error?m.message:String(m)}`),i.writableEnded||d(i,500,{ok:!1,error:"internal error"})})});await new Promise((n,i)=>{M.once("error",i),M.listen(t.port??8787,t.host??"0.0.0.0",()=>{M.off("error",i),n()})});let j=M.address(),z=j&&typeof j=="object"?j.port:t.port??8787;return o(`[relay] \u76D1\u542C ${t.host??"0.0.0.0"}:${z}`),l.record({event:"startup",detail:`listen ${t.host??"0.0.0.0"}:${z}`}),{port:z,close:()=>new Promise(n=>{l.record({event:"shutdown"});for(let i of u.values())for(let m of[...i.waiters])m();M.close(()=>{l.flush().then(()=>n())}),setTimeout(()=>n(),1500).unref?.()})}}async function ke(){let t=Number(process.env.PLAITCODE_PORT??8787),e=process.env.PLAITCODE_HOST??"127.0.0.1",r=process.env.PLAITCODE_AUDIT??"/var/lib/plaitcode-relay/audit.jsonl",c=process.env.PLAITCODE_AUDIT_STDOUT!=="0",o=process.env.PLAITCODE_IDENTITY?.trim(),l=process.env.PLAITCODE_ADMIN_TOKEN?.trim()??"",u=o?{state:await se(o)??Q(),path:o}:void 0;u&&(console.log(`[relay] \u8EAB\u4EFD\u6A21\u5F0F\uFF1A${u.state.orgs.length} \u7EC4\u7EC7 / ${u.state.members.length} \u6210\u5458 / ${u.state.devices.length} \u8BBE\u5907`),l||console.log("[relay] \u8B66\u544A\uFF1A\u6CA1\u8BBE PLAITCODE_ADMIN_TOKEN\uFF0C\u7BA1\u7406\u63A5\u53E3\u4E0D\u53EF\u7528"));let k=await ue({port:Number.isFinite(t)&&t>0?t:8787,host:e,log:A=>console.log(A),...u?{identity:u}:{},...l?{adminToken:l}:{},audit:{...r&&r!=="-"?{path:r}:{},...c?{sink:A=>console.log(`[audit] ${A}`)}:{},includeIp:process.env.PLAITCODE_AUDIT_IP!=="0",maxBytes:Number(process.env.PLAITCODE_AUDIT_MAX_BYTES??20*1024*1024),keep:Number(process.env.PLAITCODE_AUDIT_KEEP??5)}});console.log(`[relay] ready on http://${e}:${k.port}`);let D=A=>{console.log(`[relay] ${A}\uFF0C\u6B63\u5728\u5173\u95ED`),k.close().then(()=>process.exit(0))};process.on("SIGTERM",()=>D("SIGTERM")),process.on("SIGINT",()=>D("SIGINT"))}ke().catch(t=>{console.error(`[relay] \u542F\u52A8\u5931\u8D25\uFF1A${t instanceof Error?t.message:String(t)}`),process.exit(1)});
