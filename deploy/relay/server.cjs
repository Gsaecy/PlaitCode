"use strict";var H=require("node:crypto"),Ae=require("node:http");var M=require("node:fs/promises"),Z=require("node:path"),F=class{constructor(t={}){this.options=t;this.maxBytes=Math.max(4*1024,t.maxBytes??20*1024*1024),this.keep=Math.max(1,Math.min(t.keep??3,20)),this.includeIp=t.includeIp??!0}options;maxBytes;keep;includeIp;queue=Promise.resolve();written=0;record(t){let n={ts:(this.options.now?.()??new Date).toISOString(),event:t.event,...t.channel?{channel:t.channel}:{},...t.device?{device:t.device}:{},...t.message?{message:t.message}:{},...t.ip&&this.includeIp?{ip:t.ip}:{},...typeof t.bytes=="number"?{bytes:t.bytes}:{},...t.detail?{detail:t.detail}:{}},o=`${JSON.stringify(n)}
`;try{this.options.sink?.(o.trimEnd())}catch{}let d=this.options.path;d&&(this.queue=this.queue.then(()=>this.append(d,o)).catch(()=>{}))}async flush(){await this.queue.catch(()=>{})}async append(t,n){let o=Buffer.byteLength(n);this.written===0&&(this.written=await(0,M.stat)(t).then(d=>d.size).catch(()=>0)),this.written+o>this.maxBytes&&(await this.rotate(t),this.written=0),await(0,M.mkdir)((0,Z.dirname)(t),{recursive:!0}).catch(()=>{}),await(0,M.appendFile)(t,n,"utf8"),this.written+=o}async rotate(t){for(let n=this.keep;n>=1;n-=1){let o=n===1?t:`${t}.${n-1}`,d=`${t}.${n}`;await(0,M.rename)(o,d).catch(()=>{})}}};var ee="plaitcode/channel/1:",te="plaitcode/relay/1:",ne="plaitcode/enc/1:";function re(e){return`<!doctype html>
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
  <span class="meta" id="meta">${e.relayHost.replace(/[<>&"]/g,"")}</span>
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
    return Promise.all([digest('${ee}'), digest('${te}'), digest('${ne}')])
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
</html>`}var Qe=10*6e4,Ze=720*6e4;var et=5*6e4;function ie(e){let t={};for(let n of(e??"").split(";")){let o=n.indexOf("=");if(o<=0)continue;let d=n.slice(0,o).trim();d&&(t[d]=decodeURIComponent(n.slice(o+1).trim()))}return t}var L=require("node:crypto"),R=require("node:fs/promises"),oe=require("node:path"),Y=1,Le=100;function ae(){return{version:Y,orgs:[],members:[],devices:[]}}function q(e){return`${e}_${(0,L.randomBytes)(9).toString("base64url")}`}function Be(){return`pct_${(0,L.randomBytes)(24).toString("base64url")}`}function se(e){return(0,L.createHash)("sha256").update(e,"utf8").digest("hex")}function He(e,t){let n=Buffer.from(e,"utf8"),o=Buffer.from(t,"utf8");return n.length===o.length&&(0,L.timingSafeEqual)(n,o)}var Ne={viewer:["poll","presence"],member:["publish","poll","presence"],admin:["publish","poll","presence","manage"],owner:["publish","poll","presence","manage"]};function Ue(e,t){return(Ne[e]??[]).includes(t)}function de(e){return e==="owner"||e==="admin"||e==="member"||e==="viewer"}function ce(e,t){let n={id:q("org"),name:t.trim().slice(0,80)||"org",createdAt:Date.now()};return e.orgs.push(n),n}function V(e,t){if(!e.orgs.some(d=>d.id===t.orgId))return;let n=de(t.role)?t.role:"member",o={id:q("mem"),orgId:t.orgId,name:t.name.trim().slice(0,80)||"member",role:n,createdAt:Date.now()};return e.members.push(o),o}function le(e,t){let n=e.members.find(u=>u.id===t.memberId);if(!n)return;let o=Be(),d=t.channels.filter(u=>typeof u.channelId=="string"&&u.channelId.trim().length>0).slice(0,Le).map(u=>({channelId:u.channelId.trim().slice(0,64),role:de(u.role)?u.role:n.role})),a={id:q("dev"),memberId:n.id,name:t.name.trim().slice(0,80)||"device",platform:(t.platform??"unknown").slice(0,20),tokenHash:se(o),grants:d,createdAt:Date.now()};return e.devices.push(a),{device:a,token:o}}function ue(e,t){let n=e.devices.find(o=>o.id===t);return!n||n.revokedAt?!1:(n.revokedAt=Date.now(),!0)}function ze(e,t){if(!t.startsWith("pct_"))return;let n=se(t);return e.devices.find(o=>He(o.tokenHash,n))}function pe(e,t,n,o){let d=ze(e,t);if(!d)return{ok:!1,reason:"\u8BBE\u5907\u4EE4\u724C\u65E0\u6548"};if(d.revokedAt)return{ok:!1,device:d,reason:"\u8BBE\u5907\u5DF2\u88AB\u540A\u9500"};let a=e.members.find(f=>f.id===d.memberId);if(!a)return{ok:!1,device:d,reason:"\u8BBE\u5907\u6240\u5C5E\u6210\u5458\u5DF2\u4E0D\u5B58\u5728"};let u=d.grants.find(f=>f.channelId===n);return u?Ue(u.role,o)?(d.lastSeenAt=Date.now(),{ok:!0,device:d,member:a}):{ok:!1,device:d,member:a,reason:`\u89D2\u8272 ${u.role} \u4E0D\u80FD\u6267\u884C ${o}`}:{ok:!1,device:d,member:a,reason:"\u8FD9\u53F0\u8BBE\u5907\u6CA1\u6709\u8BE5\u9891\u9053\u7684\u6388\u6743"}}async function fe(e,t){await(0,R.mkdir)((0,oe.dirname)(e),{recursive:!0}).catch(()=>{});let n=`${e}.tmp`;await(0,R.writeFile)(n,`${JSON.stringify(t,null,2)}
`,"utf8"),await(0,R.rename)(n,e)}async function me(e){try{let t=await(0,R.readFile)(e,"utf8"),n=JSON.parse(t);return n.version!==Y||!Array.isArray(n.orgs)||!Array.isArray(n.members)||!Array.isArray(n.devices)?void 0:{version:Y,orgs:n.orgs,members:n.members,devices:n.devices}}catch{return}}function ge(e){return{version:e.version,orgs:e.orgs,members:e.members,devices:e.devices.map(t=>({id:t.id,memberId:t.memberId,name:t.name,platform:t.platform,grants:t.grants,createdAt:t.createdAt,lastSeenAt:t.lastSeenAt,revokedAt:t.revokedAt}))}}var K=require("node:crypto"),he={authorize:"https://accounts.feishu.cn/open-apis/authen/v1/authorize",token:"https://open.feishu.cn/open-apis/authen/v2/oauth/token",userinfo:"https://open.feishu.cn/open-apis/authen/v1/user_info"};function X(e){return e.toString("base64url")}function J(e,t){return X((0,K.createHmac)("sha256",e).update(t,"utf8").digest())}function ve(e,t){let n=Buffer.from(e,"utf8"),o=Buffer.from(t,"utf8");return n.length===o.length&&(0,K.timingSafeEqual)(n,o)}function be(e,t){let n={...he,...e.endpoints},o=new URL(n.authorize);return o.searchParams.set("client_id",e.appId),o.searchParams.set("app_id",e.appId),o.searchParams.set("redirect_uri",e.redirectUri),o.searchParams.set("response_type","code"),o.searchParams.set("state",t),o.toString()}function ye(e,t,n=10*6e4){let o=`${t}.${Date.now()+n}`;return`${X(Buffer.from(o,"utf8"))}.${J(e,o)}`}function xe(e,t){if(!t)return!1;let n=t.lastIndexOf(".");if(n<=0)return!1;let o=t.slice(0,n),d=t.slice(n+1),a;try{a=Buffer.from(o,"base64url").toString("utf8")}catch{return!1}if(!ve(J(e,a),d))return!1;let u=Number(a.slice(a.lastIndexOf(".")+1));return Number.isFinite(u)&&u>Date.now()}function ke(e,t){let n=X(Buffer.from(JSON.stringify(t),"utf8"));return`${n}.${J(e,n)}`}function we(e,t){if(!t)return;let n=t.lastIndexOf(".");if(n<=0)return;let o=t.slice(0,n),d=t.slice(n+1);if(ve(J(e,o),d))try{let a=JSON.parse(Buffer.from(o,"base64url").toString("utf8"));return!a.memberId||typeof a.exp!="number"||a.exp<=Date.now()?void 0:a}catch{return}}function j(e){if(!e||typeof e!="object")return{};let t=e,n=t.data;return n&&typeof n=="object"?n:t}function E(e){return typeof e=="string"&&e.trim()?e.trim():void 0}async function Se(e,t,n=fetch){let o={...he,...e.endpoints},d=[{grant_type:"authorization_code",client_id:e.appId,client_secret:e.appSecret,code:t,redirect_uri:e.redirectUri},{grant_type:"authorization_code",app_id:e.appId,app_secret:e.appSecret,code:t}],a="\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE access_token";for(let u of d)try{let f=await n(o.token,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(u)}),I=await f.json().catch(()=>{}),C=E(j(I).access_token);if(!f.ok||!C){a=E(j(I).error_description)??E(j(I).msg)??`HTTP ${f.status}`;continue}let O=await(await n(o.userinfo,{headers:{authorization:`Bearer ${C}`}})).json().catch(()=>{}),S=j(O),T=E(S.name)??E(S.en_name);if(!T){a="\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE\u7528\u6237\u59D3\u540D";continue}return{ok:!0,identity:{name:T,...E(S.email)??E(S.enterprise_email)?{email:E(S.email)??E(S.enterprise_email)}:{},...E(S.open_id)?{openId:E(S.open_id)}:{},...E(S.union_id)?{unionId:E(S.union_id)}:{}}}}catch(f){a=f instanceof Error?f.message:String(f)}return{ok:!1,error:a}}function Ie(e,t){if(!t.length)return!0;if(!e)return!1;let n=e.lastIndexOf("@");if(n<0)return!1;let o=e.slice(n+1).toLowerCase();return t.some(d=>d.trim().toLowerCase().replace(/^@/,"")===o)}var Fe="1",je=96*1024,Ke=9e4;function Ee(e){return(0,H.createHash)("sha256").update(e,"utf8").digest("hex")}function l(e,t,n,o={}){let d=JSON.stringify(n);e.writeHead(t,{"content-type":"application/json; charset=utf-8","content-length":Buffer.byteLength(d),"cache-control":"no-store","x-content-type-options":"nosniff",...o}),e.end(d)}function W(e){return new Promise(t=>{let n=[],o=0;e.on("data",d=>{if(o+=d.length,o>je){t(void 0),e.destroy();return}n.push(d)}),e.on("end",()=>t(Buffer.concat(n).toString("utf8"))),e.on("error",()=>t(void 0))})}function U(e){let t=e.headers.authorization??"";return/^Bearer\s+(.+)$/i.exec(t.trim())?.[1]?.trim()??""}function w(e){let t=e.headers["x-real-ip"];if(typeof t=="string"&&t.trim())return t.trim();let n=e.headers["x-forwarded-for"];return typeof n=="string"&&n.trim()?n.split(",")[0].trim():(e.socket.remoteAddress??"").replace(/^::ffff:/,"")}async function Ce(e={}){let t=Math.max(20,e.maxMessages??500),n=Math.max(1e3,Math.min(e.maxWaitMs??22e3,25e3)),o=Math.max(10,e.rateLimit??240),d=e.log??(()=>{}),a=new F(e.audit),u=new Map,f=new Map,I=(i,r)=>{let g=u.get(i);if(g)return g.keyHash===Ee(r)?g:void 0;if(!/^[0-9a-f]{16,64}$/.test(i))return;let h={keyHash:Ee(r),createdAt:Date.now(),seq:0,messages:[],waiters:[],seen:new Set,presence:new Map};return u.set(i,h),d(`[relay] \u65B0\u9891\u9053 ${i.slice(0,8)}\u2026`),h},C=i=>{let r=Date.now(),g=f.get(i);return!g||r>=g.resetAt?(f.set(i,{count:1,resetAt:r+6e4}),!0):(g.count+=1,g.count<=o)},b=e.identity,O=e.adminToken??"",S=i=>{if(!/^[0-9a-f]{16,64}$/.test(i))return;let r=u.get(i);if(r)return r;let g={keyHash:"",createdAt:Date.now(),seq:0,messages:[],waiters:[],seen:new Set,presence:new Map};return u.set(i,g),d(`[relay] \u65B0\u9891\u9053 ${i.slice(0,8)}\u2026\uFF08\u8EAB\u4EFD\u6A21\u5F0F\uFF09`),g},T=(i,r,g)=>{if(!b)return{ok:!0};let h=pe(b.state,i,r,g);return h.ok?{ok:!0,deviceId:h.device?.id,member:h.member?.name}:{ok:!1,reason:h.reason??"\u672A\u6388\u6743"}},_=async()=>{b?.path&&await fe(b.path,b.state).catch(i=>{d(`[relay] \u8EAB\u4EFD\u5E93\u5199\u5165\u5931\u8D25\uFF1A${i instanceof Error?i.message:String(i)}`)})},z=i=>{if(!O||typeof i!="string")return!1;let r=(0,H.createHash)("sha256").update(i).digest(),g=(0,H.createHash)("sha256").update(O).digest();return r.length===g.length&&(0,H.timingSafeEqual)(r,g)},D=(0,Ae.createServer)((i,r)=>{(async()=>{let g=i.url??"/",h=g.split("?")[0]??"/",B=new URLSearchParams(g.slice(g.indexOf("?")+1)),Q=h==="/health"||h==="/";if(!(Q||h==="/m")){let p=w(i);if(!C(p)){a.record({event:"denied",ip:p,detail:"rate limited"}),l(r,429,{ok:!1,error:"too many requests"});return}}if(i.method==="GET"&&h==="/m"){let p=re({relayHost:typeof i.headers.host=="string"?i.headers.host:"plaitcode.com"});r.writeHead(200,{"content-type":"text/html; charset=utf-8","content-length":Buffer.byteLength(p),"cache-control":"no-store","x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"no-referrer"}),r.end(p);return}if(h==="/v1/auth/feishu/start"&&i.method==="GET"){let p=e.auth;if(!p||!b){l(r,404,{ok:!1,error:"sso disabled"});return}let c=ye(p.secret,crypto.randomUUID());r.writeHead(302,{location:be(p.config,c),"cache-control":"no-store"}),r.end();return}if(h==="/v1/auth/feishu/callback"&&i.method==="GET"){let p=e.auth;if(!p||!b){l(r,404,{ok:!1,error:"sso disabled"});return}if(!xe(p.secret,B.get("state")??void 0)){a.record({event:"denied",ip:w(i),detail:"sso state invalid"}),l(r,400,{ok:!1,error:"state \u65E0\u6548\u6216\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55"});return}let c=B.get("code")??"";if(!c){l(r,400,{ok:!1,error:"\u7F3A\u5C11 code"});return}let s=await Se(p.config,c);if(!s.ok){a.record({event:"denied",ip:w(i),detail:`sso exchange failed: ${s.error}`}),l(r,502,{ok:!1,error:`\u98DE\u4E66\u767B\u5F55\u5931\u8D25\uFF1A${s.error}`});return}if(!Ie(s.identity.email,p.emailDomains??[])){a.record({event:"denied",ip:w(i),detail:`sso email not allowed: ${s.identity.email??"(none)"}`}),l(r,403,{ok:!1,error:"\u8FD9\u4E2A\u90AE\u7BB1\u4E0D\u5728\u5141\u8BB8\u7684\u57DF\u540D\u5185"});return}let m=b.state.members.find(v=>s.identity.email&&v.name&&v.id&&v.email===s.identity.email);if(!m&&s.identity.email){let v=b.state.orgs[0];if(!v){l(r,409,{ok:!1,error:"\u670D\u52A1\u7AEF\u8FD8\u6CA1\u6709\u7EC4\u7EC7\uFF0C\u8BF7\u7BA1\u7406\u5458\u5148\u5EFA\u7EC4\u7EC7"});return}m=V(b.state,{orgId:v.id,name:s.identity.name,role:"member"}),m&&(m.email=s.identity.email,await _(),a.record({event:"admin",ip:w(i),detail:`auto-provision ${s.identity.email}`}))}if(!m){l(r,409,{ok:!1,error:"\u65E0\u6CD5\u5EFA\u7ACB\u6210\u5458\u8EAB\u4EFD\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458"});return}let y=p.sessionTtlMs??720*6e4,P=ke(p.secret,{memberId:m.id,name:m.name,...s.identity.email?{email:s.identity.email}:{},exp:Date.now()+y});a.record({event:"login",ip:w(i),detail:m.name}),r.writeHead(302,{location:"/m","set-cookie":`plaitcode_session=${P}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(y/1e3)}`,"cache-control":"no-store"}),r.end();return}if(h==="/v1/auth/me"&&i.method==="GET"){let p=e.auth;if(!p){l(r,404,{ok:!1,error:"sso disabled"});return}let c=we(p.secret,ie(i.headers.cookie).plaitcode_session);if(!c){l(r,401,{ok:!1,error:"\u672A\u767B\u5F55"});return}l(r,200,{ok:!0,member:{id:c.memberId,name:c.name,email:c.email??null}});return}if(h==="/v1/auth/logout"&&i.method==="POST"){r.writeHead(200,{"content-type":"application/json; charset=utf-8","set-cookie":"plaitcode_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"}),r.end(JSON.stringify({ok:!0}));return}if(h.startsWith("/v1/admin/")){if(!b||!O){l(r,404,{ok:!1,error:"admin api disabled"});return}if(!z(i.headers["x-plaitcode-admin"])){a.record({event:"denied",ip:w(i),detail:"admin auth failed"}),l(r,403,{ok:!1,error:"admin denied"});return}let p=i.method==="POST"?await W(i):"";if(p===void 0){l(r,413,{ok:!1,error:"body too large"});return}let c={};if(p)try{c=JSON.parse(p)}catch{l(r,400,{ok:!1,error:"invalid json"});return}if(h==="/v1/admin/state"&&i.method==="GET"){l(r,200,{ok:!0,identity:ge(b.state)});return}if(h==="/v1/admin/orgs"&&i.method==="POST"){let s=ce(b.state,String(c.name??""));await _(),a.record({event:"admin",ip:w(i),detail:`org ${s.name}`}),l(r,200,{ok:!0,org:s});return}if(h==="/v1/admin/members"&&i.method==="POST"){let s=V(b.state,{orgId:String(c.orgId??""),name:String(c.name??""),role:c.role});if(!s){l(r,404,{ok:!1,error:"org not found"});return}await _(),a.record({event:"admin",ip:w(i),detail:`member ${s.name} (${s.role})`}),l(r,200,{ok:!0,member:s});return}if(h==="/v1/admin/devices"&&i.method==="POST"){let s=Array.isArray(c.channels)?c.channels:[],m=le(b.state,{memberId:String(c.memberId??""),name:String(c.name??""),platform:typeof c.platform=="string"?c.platform:void 0,channels:s.filter(y=>!!y&&typeof y=="object").map(y=>({channelId:String(y.channelId??""),role:y.role}))});if(!m){l(r,404,{ok:!1,error:"member not found"});return}await _(),a.record({event:"admin",ip:w(i),detail:`device ${m.device.name} for ${m.device.memberId}`}),l(r,200,{ok:!0,device:{id:m.device.id,memberId:m.device.memberId,name:m.device.name,grants:m.device.grants},token:m.token});return}if(h==="/v1/admin/devices/revoke"&&i.method==="POST"){let s=ue(b.state,String(c.deviceId??""));await _(),a.record({event:"admin",ip:w(i),detail:`revoke ${String(c.deviceId??"")} -> ${s}`}),l(r,s?200:404,{ok:s});return}l(r,404,{ok:!1,error:"not found"});return}if(i.method==="GET"&&Q){l(r,200,{ok:!0,service:"plaitcode-relay",version:Fe,channels:u.size,uptime:Math.round(process.uptime())});return}if(!h.startsWith("/v1/")){l(r,404,{ok:!1,error:"not found"});return}if(i.method==="GET"&&h==="/v1/poll"){let p=B.get("channel")??"",c=T(U(i),p,"poll");if(!c.ok){a.record({event:"denied",channel:p.slice(0,32),ip:w(i),detail:c.reason}),l(r,403,{ok:!1,error:c.reason});return}let s=b?S(p):I(p,U(i));if(!s){l(r,403,{ok:!1,error:"channel denied"});return}let m=Number(B.get("since")??0)||0,y=Math.min(Math.max(Number(B.get("wait")??20)*1e3||2e4,0),n),P=()=>s.messages.filter($=>$.seq>m),v=P();if(v.length||y===0){l(r,200,{ok:!0,messages:v.slice(-200),seq:s.seq});return}let k=!1,x=()=>{if(k)return;k=!0;let $=s.waiters.indexOf(x);$>=0&&s.waiters.splice($,1),clearTimeout(N),!r.writableEnded&&l(r,200,{ok:!0,messages:P().slice(-200),seq:s.seq})},N=setTimeout(x,y);N.unref?.(),s.waiters.push(x),i.on("close",()=>{if(k)return;k=!0;let $=s.waiters.indexOf(x);$>=0&&s.waiters.splice($,1),clearTimeout(N)});return}if(i.method==="POST"&&h==="/v1/publish"){let p=await W(i);if(!p){l(r,413,{ok:!1,error:"body too large"});return}let c;try{c=JSON.parse(p)}catch{l(r,400,{ok:!1,error:"invalid json"});return}let s=typeof c.channel=="string"?c.channel:"",m=typeof c.id=="string"?c.id.slice(0,80):"",y=typeof c.from=="string"?c.from.slice(0,80):"",P=typeof c.envelope?.iv=="string"?c.envelope.iv:"",v=typeof c.envelope?.ct=="string"?c.envelope.ct:"";if(!m||!y||!P||!v||v.length>64*1024){l(r,400,{ok:!1,error:"invalid message"});return}let k=T(U(i),s,"publish");if(!k.ok){a.record({event:"denied",channel:s.slice(0,32),ip:w(i),detail:k.reason}),l(r,403,{ok:!1,error:k.reason});return}let x=b?S(s):I(s,U(i));if(!x){a.record({event:"denied",channel:s.slice(0,32),ip:w(i),detail:"channel denied"}),l(r,403,{ok:!1,error:"channel denied"});return}if(x.seen.has(m)){a.record({event:"publish",channel:s,device:y,message:m,ip:w(i),detail:"duplicate"}),l(r,200,{ok:!0,duplicate:!0,seq:x.seq});return}x.seq+=1,x.seen.add(m),a.record({event:"publish",channel:s,device:y,message:m,ip:w(i),bytes:v.length}),x.seen.size>t*4&&(x.seen=new Set([...x.seen].slice(-t*2))),x.messages.push({seq:x.seq,id:m,from:y,envelope:{iv:P,ct:v},at:Date.now()}),x.messages.length>t&&(x.messages=x.messages.slice(-t));for(let N of[...x.waiters])N();l(r,200,{ok:!0,seq:x.seq});return}if(h==="/v1/presence"){let p=U(i),c=B.get("channel")??"",s;if(i.method==="POST"){let v=await W(i);if(!v){l(r,413,{ok:!1,error:"body too large"});return}let k;try{k=JSON.parse(v)}catch{l(r,400,{ok:!1,error:"invalid json"});return}c=typeof k.channel=="string"?k.channel:"",s=k.device}let m=T(p,c,"presence");if(!m.ok){a.record({event:"denied",channel:c.slice(0,32),ip:w(i),detail:m.reason}),l(r,403,{ok:!1,error:m.reason});return}let y=b?S(c):I(c,p);if(!y){l(r,403,{ok:!1,error:"channel denied"});return}if(s){let v=m.deviceId??(typeof s.id=="string"?s.id.slice(0,80):"");if(!v){l(r,400,{ok:!1,error:"invalid device"});return}y.presence.set(v,{name:m.member?`${m.member} \xB7 ${typeof s.name=="string"?s.name.slice(0,60):"\u8BBE\u5907"}`:typeof s.name=="string"?s.name.slice(0,120):v,platform:typeof s.platform=="string"?s.platform:"unknown",project:typeof s.project=="string"?s.project.slice(0,120):"",at:Date.now()})}let P=Date.now();for(let[v,k]of y.presence)P-k.at>Ke&&y.presence.delete(v);l(r,200,{ok:!0,devices:[...y.presence.entries()].map(([v,k])=>({id:v,...k}))});return}l(r,404,{ok:!1,error:"not found"})})().catch(g=>{d(`[relay] \u8BF7\u6C42\u5904\u7406\u5931\u8D25\uFF1A${g instanceof Error?g.message:String(g)}`),r.writableEnded||l(r,500,{ok:!1,error:"internal error"})})});await new Promise((i,r)=>{D.once("error",r),D.listen(e.port??8787,e.host??"0.0.0.0",()=>{D.off("error",r),i()})});let A=D.address(),G=A&&typeof A=="object"?A.port:e.port??8787;return d(`[relay] \u76D1\u542C ${e.host??"0.0.0.0"}:${G}`),a.record({event:"startup",detail:`listen ${e.host??"0.0.0.0"}:${G}`}),{port:G,close:()=>new Promise(i=>{a.record({event:"shutdown"});for(let r of u.values())for(let g of[...r.waiters])g();D.close(()=>{a.flush().then(()=>i())}),setTimeout(()=>i(),1500).unref?.()})}}var _e=require("node:dgram"),Pe=require("node:http"),Oe=require("node:https"),De=require("node:net");function Me(e){let t=(e??"").trim();if(t)try{if(/^otlp\+https?:\/\//i.test(t))return{kind:"otlp",url:new URL(t.replace(/^otlp\+/i,""))};if(/^syslog\+tcp:\/\//i.test(t))return{kind:"syslog-tcp",url:new URL(t.replace(/^syslog\+tcp:/i,"http:"))};if(/^syslog:\/\//i.test(t))return{kind:"syslog",url:new URL(t.replace(/^syslog:/i,"http:"))};if(/^https?:\/\//i.test(t))return{kind:"webhook",url:new URL(t)}}catch{return}}function Te(e,t,n){let o;try{o=e}catch{return}let d=Buffer.from(t,"utf8"),u=(o.protocol==="https:"?Oe.request:Pe.request)(o,{method:"POST",headers:{"content-type":"application/json","content-length":String(d.length)},timeout:n},f=>{f.resume()});u.on("timeout",()=>u.destroy()),u.on("error",()=>{}),u.end(d)}function Je(e,t){let n=`${Date.now()}000000`;try{let o=JSON.parse(e);if(typeof o.ts=="string"){let d=Date.parse(o.ts);Number.isFinite(d)&&(n=`${d}000000`)}}catch{}return JSON.stringify({resourceLogs:[{resource:{attributes:[{key:"service.name",value:{stringValue:"plaitcode-relay"}},{key:"host.name",value:{stringValue:t}}]},scopeLogs:[{scope:{name:"plaitcode.audit"},logRecords:[{timeUnixNano:n,severityText:"INFO",body:{stringValue:e}}]}]}]})}function Re(e,t={}){let n=t.hostname??"plaitcode-relay";if(e.kind==="webhook")return{send:f=>Te(e.url,f,5e3),close:()=>{}};if(e.kind==="otlp")return{send:f=>Te(e.url,Je(f,n),5e3),close:()=>{}};let o=e.url.hostname,d=Number(e.url.port||514);if(e.kind==="syslog"){let f=(0,_e.createSocket)("udp4");return f.on("error",()=>{}),f.unref?.(),{send:I=>{let C=`<14>1 - ${n} plaitcode-relay - AUDIT - ${I}`;try{f.send(Buffer.from(C,"utf8"),d,o,()=>{})}catch{}},close:()=>{try{f.close()}catch{}}}}let a,u=()=>(a&&!a.destroyed||(a=(0,De.connect)(d,o,()=>{}),a.on("error",()=>{a=void 0}),a.on("close",()=>{a=void 0}),a.unref?.()),a);return{send:f=>{let I=u();if(I)try{I.write(`<14>1 - ${n} plaitcode-relay - AUDIT - ${f}
`)}catch{a=void 0}},close:()=>{try{a?.destroy()}catch{}}}}var $e=require("node:os");async function Ge(){let e=Number(process.env.PLAITCODE_PORT??8787),t=process.env.PLAITCODE_HOST??"127.0.0.1",n=process.env.PLAITCODE_AUDIT??"/var/lib/plaitcode-relay/audit.jsonl",o=process.env.PLAITCODE_AUDIT_STDOUT!=="0",d=process.env.PLAITCODE_IDENTITY?.trim(),a=process.env.PLAITCODE_ADMIN_TOKEN?.trim()??"",u=d?{state:await me(d)??ae(),path:d}:void 0;u&&(console.log(`[relay] \u8EAB\u4EFD\u6A21\u5F0F\uFF1A${u.state.orgs.length} \u7EC4\u7EC7 / ${u.state.members.length} \u6210\u5458 / ${u.state.devices.length} \u8BBE\u5907`),a||console.log("[relay] \u8B66\u544A\uFF1A\u6CA1\u8BBE PLAITCODE_ADMIN_TOKEN\uFF0C\u7BA1\u7406\u63A5\u53E3\u4E0D\u53EF\u7528"));let f=Me(process.env.PLAITCODE_AUDIT_SINK),I=f?Re(f,{hostname:(0,$e.hostname)()}):void 0;f&&console.log(`[relay] \u5BA1\u8BA1\u5916\u9001\uFF1A${f.kind} \u2192 ${f.url.host}`);let C=process.env.PLAITCODE_FEISHU_APP_ID?.trim()??"",b=process.env.PLAITCODE_FEISHU_APP_SECRET?.trim()??"",O=process.env.PLAITCODE_AUTH_SECRET?.trim()??"",S=(process.env.PLAITCODE_PUBLIC_URL?.trim()||"https://plaitcode.com").replace(/\/+$/,""),T=C&&b?{appId:C,appSecret:b,redirectUri:`${S}/v1/auth/feishu/callback`,...process.env.PLAITCODE_FEISHU_AUTHORIZE?{endpoints:{authorize:process.env.PLAITCODE_FEISHU_AUTHORIZE}}:{},...process.env.PLAITCODE_FEISHU_TOKEN?{endpoints:{token:process.env.PLAITCODE_FEISHU_TOKEN}}:{},...process.env.PLAITCODE_FEISHU_USERINFO?{endpoints:{userinfo:process.env.PLAITCODE_FEISHU_USERINFO}}:{}}:void 0,_=T&&O&&u?{config:T,secret:O,emailDomains:(process.env.PLAITCODE_AUTH_EMAIL_DOMAINS??"").split(",").map(A=>A.trim()).filter(Boolean)}:void 0;_?console.log("[relay] \u98DE\u4E66\u767B\u5F55\u5DF2\u542F\u7528"):C&&console.log("[relay] \u8B66\u544A\uFF1A\u98DE\u4E66\u767B\u5F55\u9700\u8981 PLAITCODE_AUTH_SECRET \u4E0E\u8EAB\u4EFD\u5E93\uFF08PLAITCODE_IDENTITY\uFF09");let z=await Ce({port:Number.isFinite(e)&&e>0?e:8787,host:t,log:A=>console.log(A),...u?{identity:u}:{},...a?{adminToken:a}:{},..._?{auth:_}:{},audit:{...n&&n!=="-"?{path:n}:{},sink:(A=>{o&&console.log(`[audit] ${A}`),I?.send(A)}),includeIp:process.env.PLAITCODE_AUDIT_IP!=="0",maxBytes:Number(process.env.PLAITCODE_AUDIT_MAX_BYTES??20*1024*1024),keep:Number(process.env.PLAITCODE_AUDIT_KEEP??5)}});console.log(`[relay] ready on http://${t}:${z.port}`);let D=A=>{console.log(`[relay] ${A}\uFF0C\u6B63\u5728\u5173\u95ED`),I?.close(),z.close().then(()=>process.exit(0))};process.on("SIGTERM",()=>D("SIGTERM")),process.on("SIGINT",()=>D("SIGINT"))}Ge().catch(e=>{console.error(`[relay] \u542F\u52A8\u5931\u8D25\uFF1A${e instanceof Error?e.message:String(e)}`),process.exit(1)});
