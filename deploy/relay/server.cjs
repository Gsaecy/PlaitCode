"use strict";var H=require("node:crypto"),Ce=require("node:http");var M=require("node:fs/promises"),Z=require("node:path"),F=class{constructor(e={}){this.options=e;this.maxBytes=Math.max(4*1024,e.maxBytes??20*1024*1024),this.keep=Math.max(1,Math.min(e.keep??3,20)),this.includeIp=e.includeIp??!0}options;maxBytes;keep;includeIp;queue=Promise.resolve();written=0;record(e){let n={ts:(this.options.now?.()??new Date).toISOString(),event:e.event,...e.channel?{channel:e.channel}:{},...e.device?{device:e.device}:{},...e.message?{message:e.message}:{},...e.ip&&this.includeIp?{ip:e.ip}:{},...typeof e.bytes=="number"?{bytes:e.bytes}:{},...e.detail?{detail:e.detail}:{}},r=`${JSON.stringify(n)}
`;try{this.options.sink?.(r.trimEnd())}catch{}let a=this.options.path;a&&(this.queue=this.queue.then(()=>this.append(a,r)).catch(()=>{}))}async flush(){await this.queue.catch(()=>{})}async append(e,n){let r=Buffer.byteLength(n);this.written===0&&(this.written=await(0,M.stat)(e).then(a=>a.size).catch(()=>0)),this.written+r>this.maxBytes&&(await this.rotate(e),this.written=0),await(0,M.mkdir)((0,Z.dirname)(e),{recursive:!0}).catch(()=>{}),await(0,M.appendFile)(e,n,"utf8"),this.written+=r}async rotate(e){for(let n=this.keep;n>=1;n-=1){let r=n===1?e:`${e}.${n-1}`,a=`${e}.${n}`;await(0,M.rename)(r,a).catch(()=>{})}}};var ee="plaitcode/channel/1:",te="plaitcode/relay/1:",ne="plaitcode/enc/1:";function re(t){return`<!doctype html>
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
</html>`}var Ze=10*6e4,et=720*6e4;var tt=5*6e4;function ie(t){let e={};for(let n of(t??"").split(";")){let r=n.indexOf("=");if(r<=0)continue;let a=n.slice(0,r).trim();a&&(e[a]=decodeURIComponent(n.slice(r+1).trim()))}return e}var $=require("node:crypto"),R=require("node:fs/promises"),oe=require("node:path"),Y=1,Be=100;function ae(){return{version:Y,orgs:[],members:[],devices:[]}}function V(t){return`${t}_${(0,$.randomBytes)(9).toString("base64url")}`}function He(){return`pct_${(0,$.randomBytes)(24).toString("base64url")}`}function se(t){return(0,$.createHash)("sha256").update(t,"utf8").digest("hex")}function Ne(t,e){let n=Buffer.from(t,"utf8"),r=Buffer.from(e,"utf8");return n.length===r.length&&(0,$.timingSafeEqual)(n,r)}var Ue={viewer:["poll","presence"],member:["publish","poll","presence"],admin:["publish","poll","presence","manage"],owner:["publish","poll","presence","manage"]};function ze(t,e){return(Ue[t]??[]).includes(e)}function de(t){return t==="owner"||t==="admin"||t==="member"||t==="viewer"}function ce(t,e){let n={id:V("org"),name:e.trim().slice(0,80)||"org",createdAt:Date.now()};return t.orgs.push(n),n}function q(t,e){if(!t.orgs.some(a=>a.id===e.orgId))return;let n=de(e.role)?e.role:"member",r={id:V("mem"),orgId:e.orgId,name:e.name.trim().slice(0,80)||"member",role:n,createdAt:Date.now()};return e.email?.trim()&&(r.email=e.email.trim()),e.openId?.trim()&&(r.openId=e.openId.trim()),e.unionId?.trim()&&(r.unionId=e.unionId.trim()),t.members.push(r),r}function le(t,e){let n=e.email?.trim().toLowerCase();if(n){let r=t.members.find(a=>a.id&&a.email?.trim().toLowerCase()===n);if(r)return r}if(e.openId){let r=t.members.find(a=>a.id&&a.openId===e.openId);if(r)return r}if(e.unionId)return t.members.find(r=>r.id&&r.unionId===e.unionId)}function ue(t,e){let n=t.members.find(u=>u.id===e.memberId);if(!n)return;let r=He(),a=e.channels.filter(u=>typeof u.channelId=="string"&&u.channelId.trim().length>0).slice(0,Be).map(u=>({channelId:u.channelId.trim().slice(0,64),role:de(u.role)?u.role:n.role})),s={id:V("dev"),memberId:n.id,name:e.name.trim().slice(0,80)||"device",platform:(e.platform??"unknown").slice(0,20),tokenHash:se(r),grants:a,createdAt:Date.now()};return t.devices.push(s),{device:s,token:r}}function pe(t,e){let n=t.devices.find(r=>r.id===e);return!n||n.revokedAt?!1:(n.revokedAt=Date.now(),!0)}function Fe(t,e){if(!e.startsWith("pct_"))return;let n=se(e);return t.devices.find(r=>Ne(r.tokenHash,n))}function fe(t,e,n,r){let a=Fe(t,e);if(!a)return{ok:!1,reason:"\u8BBE\u5907\u4EE4\u724C\u65E0\u6548"};if(a.revokedAt)return{ok:!1,device:a,reason:"\u8BBE\u5907\u5DF2\u88AB\u540A\u9500"};let s=t.members.find(m=>m.id===a.memberId);if(!s)return{ok:!1,device:a,reason:"\u8BBE\u5907\u6240\u5C5E\u6210\u5458\u5DF2\u4E0D\u5B58\u5728"};let u=a.grants.find(m=>m.channelId===n);return u?ze(u.role,r)?(a.lastSeenAt=Date.now(),{ok:!0,device:a,member:s}):{ok:!1,device:a,member:s,reason:`\u89D2\u8272 ${u.role} \u4E0D\u80FD\u6267\u884C ${r}`}:{ok:!1,device:a,member:s,reason:"\u8FD9\u53F0\u8BBE\u5907\u6CA1\u6709\u8BE5\u9891\u9053\u7684\u6388\u6743"}}async function me(t,e){await(0,R.mkdir)((0,oe.dirname)(t),{recursive:!0}).catch(()=>{});let n=`${t}.tmp`;await(0,R.writeFile)(n,`${JSON.stringify(e,null,2)}
`,"utf8"),await(0,R.rename)(n,t)}async function ge(t){try{let e=await(0,R.readFile)(t,"utf8"),n=JSON.parse(e);return n.version!==Y||!Array.isArray(n.orgs)||!Array.isArray(n.members)||!Array.isArray(n.devices)?void 0:{version:Y,orgs:n.orgs,members:n.members,devices:n.devices}}catch{return}}function he(t){return{version:t.version,orgs:t.orgs,members:t.members,devices:t.devices.map(e=>({id:e.id,memberId:e.memberId,name:e.name,platform:e.platform,grants:e.grants,createdAt:e.createdAt,lastSeenAt:e.lastSeenAt,revokedAt:e.revokedAt}))}}var K=require("node:crypto"),ve={authorize:"https://accounts.feishu.cn/open-apis/authen/v1/authorize",token:"https://open.feishu.cn/open-apis/authen/v2/oauth/token",userinfo:"https://open.feishu.cn/open-apis/authen/v1/user_info"};function X(t){return t.toString("base64url")}function J(t,e){return X((0,K.createHmac)("sha256",t).update(e,"utf8").digest())}function be(t,e){let n=Buffer.from(t,"utf8"),r=Buffer.from(e,"utf8");return n.length===r.length&&(0,K.timingSafeEqual)(n,r)}function ye(t,e){let n={...ve,...t.endpoints},r=new URL(n.authorize);return r.searchParams.set("client_id",t.appId),r.searchParams.set("app_id",t.appId),r.searchParams.set("redirect_uri",t.redirectUri),r.searchParams.set("response_type","code"),r.searchParams.set("state",e),r.toString()}function xe(t,e,n=10*6e4){let r=`${e}.${Date.now()+n}`;return`${X(Buffer.from(r,"utf8"))}.${J(t,r)}`}function we(t,e){if(!e)return!1;let n=e.lastIndexOf(".");if(n<=0)return!1;let r=e.slice(0,n),a=e.slice(n+1),s;try{s=Buffer.from(r,"base64url").toString("utf8")}catch{return!1}if(!be(J(t,s),a))return!1;let u=Number(s.slice(s.lastIndexOf(".")+1));return Number.isFinite(u)&&u>Date.now()}function ke(t,e){let n=X(Buffer.from(JSON.stringify(e),"utf8"));return`${n}.${J(t,n)}`}function Ie(t,e){if(!e)return;let n=e.lastIndexOf(".");if(n<=0)return;let r=e.slice(0,n),a=e.slice(n+1);if(be(J(t,r),a))try{let s=JSON.parse(Buffer.from(r,"base64url").toString("utf8"));return!s.memberId||typeof s.exp!="number"||s.exp<=Date.now()?void 0:s}catch{return}}function j(t){if(!t||typeof t!="object")return{};let e=t,n=e.data;return n&&typeof n=="object"?n:e}function E(t){return typeof t=="string"&&t.trim()?t.trim():void 0}async function Se(t,e,n=fetch){let r={...ve,...t.endpoints},a=[{grant_type:"authorization_code",client_id:t.appId,client_secret:t.appSecret,code:e,redirect_uri:t.redirectUri},{grant_type:"authorization_code",app_id:t.appId,app_secret:t.appSecret,code:e}],s="\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE access_token";for(let u of a)try{let m=await n(r.token,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(u)}),S=await m.json().catch(()=>{}),C=E(j(S).access_token);if(!m.ok||!C){s=E(j(S).error_description)??E(j(S).msg)??`HTTP ${m.status}`;continue}let P=await(await n(r.userinfo,{headers:{authorization:`Bearer ${C}`}})).json().catch(()=>{}),I=j(P),O=E(I.name)??E(I.en_name);if(!O){s="\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE\u7528\u6237\u59D3\u540D";continue}return{ok:!0,identity:{name:O,...E(I.email)??E(I.enterprise_email)?{email:E(I.email)??E(I.enterprise_email)}:{},...E(I.open_id)?{openId:E(I.open_id)}:{},...E(I.union_id)?{unionId:E(I.union_id)}:{}}}}catch(m){s=m instanceof Error?m.message:String(m)}return{ok:!1,error:s}}function Ee(t,e){if(!e.length)return!0;if(!t)return!1;let n=t.lastIndexOf("@");if(n<0)return!1;let r=t.slice(n+1).toLowerCase();return e.some(a=>a.trim().toLowerCase().replace(/^@/,"")===r)}var je="1",Ke=96*1024,Je=9e4;function Ae(t){return(0,H.createHash)("sha256").update(t,"utf8").digest("hex")}function c(t,e,n,r={}){let a=JSON.stringify(n);t.writeHead(e,{"content-type":"application/json; charset=utf-8","content-length":Buffer.byteLength(a),"cache-control":"no-store","x-content-type-options":"nosniff",...r}),t.end(a)}function W(t){return new Promise(e=>{let n=[],r=0;t.on("data",a=>{if(r+=a.length,r>Ke){e(void 0),t.destroy();return}n.push(a)}),t.on("end",()=>e(Buffer.concat(n).toString("utf8"))),t.on("error",()=>e(void 0))})}function U(t){let e=t.headers.authorization??"";return/^Bearer\s+(.+)$/i.exec(e.trim())?.[1]?.trim()??""}function k(t){let e=t.headers["x-real-ip"];if(typeof e=="string"&&e.trim())return e.trim();let n=t.headers["x-forwarded-for"];return typeof n=="string"&&n.trim()?n.split(",")[0].trim():(t.socket.remoteAddress??"").replace(/^::ffff:/,"")}async function Te(t={}){let e=Math.max(20,t.maxMessages??500),n=Math.max(1e3,Math.min(t.maxWaitMs??22e3,25e3)),r=Math.max(10,t.rateLimit??240),a=t.log??(()=>{}),s=new F(t.audit),u=new Map,m=new Map,S=(i,o)=>{let h=u.get(i);if(h)return h.keyHash===Ae(o)?h:void 0;if(!/^[0-9a-f]{16,64}$/.test(i))return;let v={keyHash:Ae(o),createdAt:Date.now(),seq:0,messages:[],waiters:[],seen:new Set,presence:new Map};return u.set(i,v),a(`[relay] \u65B0\u9891\u9053 ${i.slice(0,8)}\u2026`),v},C=i=>{let o=Date.now(),h=m.get(i);return!h||o>=h.resetAt?(m.set(i,{count:1,resetAt:o+6e4}),!0):(h.count+=1,h.count<=r)},b=t.identity,P=t.adminToken??"",I=i=>{if(!/^[0-9a-f]{16,64}$/.test(i))return;let o=u.get(i);if(o)return o;let h={keyHash:"",createdAt:Date.now(),seq:0,messages:[],waiters:[],seen:new Set,presence:new Map};return u.set(i,h),a(`[relay] \u65B0\u9891\u9053 ${i.slice(0,8)}\u2026\uFF08\u8EAB\u4EFD\u6A21\u5F0F\uFF09`),h},O=(i,o,h)=>{if(!b)return{ok:!0};let v=fe(b.state,i,o,h);return v.ok?{ok:!0,deviceId:v.device?.id,member:v.member?.name}:{ok:!1,reason:v.reason??"\u672A\u6388\u6743"}},T=async()=>{b?.path&&await me(b.path,b.state).catch(i=>{a(`[relay] \u8EAB\u4EFD\u5E93\u5199\u5165\u5931\u8D25\uFF1A${i instanceof Error?i.message:String(i)}`)})},z=i=>{if(!P||typeof i!="string")return!1;let o=(0,H.createHash)("sha256").update(i).digest(),h=(0,H.createHash)("sha256").update(P).digest();return o.length===h.length&&(0,H.timingSafeEqual)(o,h)},D=(0,Ce.createServer)((i,o)=>{(async()=>{let h=i.url??"/",v=h.split("?")[0]??"/",B=new URLSearchParams(h.slice(h.indexOf("?")+1)),Q=v==="/health"||v==="/";if(!(Q||v==="/m")){let f=k(i);if(!C(f)){s.record({event:"denied",ip:f,detail:"rate limited"}),c(o,429,{ok:!1,error:"too many requests"});return}}if(i.method==="GET"&&v==="/m"){let f=re({relayHost:typeof i.headers.host=="string"?i.headers.host:"plaitcode.com"});o.writeHead(200,{"content-type":"text/html; charset=utf-8","content-length":Buffer.byteLength(f),"cache-control":"no-store","x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"no-referrer"}),o.end(f);return}if(v==="/v1/auth/feishu/start"&&i.method==="GET"){let f=t.auth;if(!f||!b){c(o,404,{ok:!1,error:"sso disabled"});return}let l=xe(f.secret,crypto.randomUUID());o.writeHead(302,{location:ye(f.config,l),"cache-control":"no-store"}),o.end();return}if(v==="/v1/auth/feishu/callback"&&i.method==="GET"){let f=t.auth;if(!f||!b){c(o,404,{ok:!1,error:"sso disabled"});return}if(!we(f.secret,B.get("state")??void 0)){s.record({event:"denied",ip:k(i),detail:"sso state invalid"}),c(o,400,{ok:!1,error:"state \u65E0\u6548\u6216\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55"});return}let l=B.get("code")??"";if(!l){c(o,400,{ok:!1,error:"\u7F3A\u5C11 code"});return}let d=await Se(f.config,l);if(!d.ok){s.record({event:"denied",ip:k(i),detail:`sso exchange failed: ${d.error}`}),c(o,502,{ok:!1,error:`\u98DE\u4E66\u767B\u5F55\u5931\u8D25\uFF1A${d.error}`});return}if(f.emailDomains?.length&&!d.identity.email){s.record({event:"denied",ip:k(i),detail:"sso email missing while domain allowlist configured"}),c(o,403,{ok:!1,error:"\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE\u90AE\u7BB1\uFF0C\u65E0\u6CD5\u6821\u9A8C\u57DF\u540D\u767D\u540D\u5355\u3002\u8BF7\u7ED9\u5E94\u7528\u5F00\u901A contact:user.email:readonly \u6743\u9650\u5E76\u53D1\u5E03\u7248\u672C\uFF0C\u6216\u628A PLAITCODE_AUTH_EMAIL_DOMAINS \u6E05\u7A7A\u3002"});return}if(!Ee(d.identity.email,f.emailDomains??[])){s.record({event:"denied",ip:k(i),detail:`sso email not allowed: ${d.identity.email??"(none)"}`}),c(o,403,{ok:!1,error:"\u8FD9\u4E2A\u90AE\u7BB1\u4E0D\u5728\u5141\u8BB8\u7684\u57DF\u540D\u5185"});return}let p=d.identity,g=le(b.state,p);if(!g&&(p.email||p.openId||p.unionId)){let x=b.state.orgs[0];if(!x){c(o,409,{ok:!1,error:"\u670D\u52A1\u7AEF\u8FD8\u6CA1\u6709\u7EC4\u7EC7\uFF0C\u8BF7\u7BA1\u7406\u5458\u5148\u5EFA\u7EC4\u7EC7"});return}g=q(b.state,{orgId:x.id,name:p.name,role:"member",email:p.email,openId:p.openId,unionId:p.unionId}),g&&(await T(),s.record({event:"admin",ip:k(i),detail:`auto-provision ${p.email??p.openId??p.unionId}`}))}if(!g){s.record({event:"denied",ip:k(i),detail:"sso identity has no stable key"}),c(o,409,{ok:!1,error:"\u65E0\u6CD5\u5EFA\u7ACB\u6210\u5458\u8EAB\u4EFD\uFF1A\u98DE\u4E66\u6CA1\u6709\u8FD4\u56DE\u53EF\u7528\u4E8E\u8BC6\u522B\u8EAB\u4EFD\u7684\u6807\u8BC6\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458"});return}p.email&&!g.email&&(g.email=p.email,await T());let _=f.sessionTtlMs??720*6e4,y=ke(f.secret,{memberId:g.id,name:g.name,...d.identity.email?{email:d.identity.email}:{},exp:Date.now()+_});s.record({event:"login",ip:k(i),detail:g.name}),o.writeHead(302,{location:"/m","set-cookie":`plaitcode_session=${y}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(_/1e3)}`,"cache-control":"no-store"}),o.end();return}if(v==="/v1/auth/me"&&i.method==="GET"){let f=t.auth;if(!f){c(o,404,{ok:!1,error:"sso disabled"});return}let l=Ie(f.secret,ie(i.headers.cookie).plaitcode_session);if(!l){c(o,401,{ok:!1,error:"\u672A\u767B\u5F55"});return}c(o,200,{ok:!0,member:{id:l.memberId,name:l.name,email:l.email??null}});return}if(v==="/v1/auth/logout"&&i.method==="POST"){o.writeHead(200,{"content-type":"application/json; charset=utf-8","set-cookie":"plaitcode_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"}),o.end(JSON.stringify({ok:!0}));return}if(v.startsWith("/v1/admin/")){if(!b||!P){c(o,404,{ok:!1,error:"admin api disabled"});return}if(!z(i.headers["x-plaitcode-admin"])){s.record({event:"denied",ip:k(i),detail:"admin auth failed"}),c(o,403,{ok:!1,error:"admin denied"});return}let f=i.method==="POST"?await W(i):"";if(f===void 0){c(o,413,{ok:!1,error:"body too large"});return}let l={};if(f)try{l=JSON.parse(f)}catch{c(o,400,{ok:!1,error:"invalid json"});return}if(v==="/v1/admin/state"&&i.method==="GET"){c(o,200,{ok:!0,identity:he(b.state)});return}if(v==="/v1/admin/orgs"&&i.method==="POST"){let d=ce(b.state,String(l.name??""));await T(),s.record({event:"admin",ip:k(i),detail:`org ${d.name}`}),c(o,200,{ok:!0,org:d});return}if(v==="/v1/admin/members"&&i.method==="POST"){let d=q(b.state,{orgId:String(l.orgId??""),name:String(l.name??""),role:l.role});if(!d){c(o,404,{ok:!1,error:"org not found"});return}await T(),s.record({event:"admin",ip:k(i),detail:`member ${d.name} (${d.role})`}),c(o,200,{ok:!0,member:d});return}if(v==="/v1/admin/devices"&&i.method==="POST"){let d=Array.isArray(l.channels)?l.channels:[],p=ue(b.state,{memberId:String(l.memberId??""),name:String(l.name??""),platform:typeof l.platform=="string"?l.platform:void 0,channels:d.filter(g=>!!g&&typeof g=="object").map(g=>({channelId:String(g.channelId??""),role:g.role}))});if(!p){c(o,404,{ok:!1,error:"member not found"});return}await T(),s.record({event:"admin",ip:k(i),detail:`device ${p.device.name} for ${p.device.memberId}`}),c(o,200,{ok:!0,device:{id:p.device.id,memberId:p.device.memberId,name:p.device.name,grants:p.device.grants},token:p.token});return}if(v==="/v1/admin/devices/revoke"&&i.method==="POST"){let d=pe(b.state,String(l.deviceId??""));await T(),s.record({event:"admin",ip:k(i),detail:`revoke ${String(l.deviceId??"")} -> ${d}`}),c(o,d?200:404,{ok:d});return}c(o,404,{ok:!1,error:"not found"});return}if(i.method==="GET"&&Q){c(o,200,{ok:!0,service:"plaitcode-relay",version:je,channels:u.size,uptime:Math.round(process.uptime())});return}if(!v.startsWith("/v1/")){c(o,404,{ok:!1,error:"not found"});return}if(i.method==="GET"&&v==="/v1/poll"){let f=B.get("channel")??"",l=O(U(i),f,"poll");if(!l.ok){s.record({event:"denied",channel:f.slice(0,32),ip:k(i),detail:l.reason}),c(o,403,{ok:!1,error:l.reason});return}let d=b?I(f):S(f,U(i));if(!d){c(o,403,{ok:!1,error:"channel denied"});return}let p=Number(B.get("since")??0)||0,g=Math.min(Math.max(Number(B.get("wait")??20)*1e3||2e4,0),n),_=()=>d.messages.filter(L=>L.seq>p),y=_();if(y.length||g===0){c(o,200,{ok:!0,messages:y.slice(-200),seq:d.seq});return}let x=!1,w=()=>{if(x)return;x=!0;let L=d.waiters.indexOf(w);L>=0&&d.waiters.splice(L,1),clearTimeout(N),!o.writableEnded&&c(o,200,{ok:!0,messages:_().slice(-200),seq:d.seq})},N=setTimeout(w,g);N.unref?.(),d.waiters.push(w),i.on("close",()=>{if(x)return;x=!0;let L=d.waiters.indexOf(w);L>=0&&d.waiters.splice(L,1),clearTimeout(N)});return}if(i.method==="POST"&&v==="/v1/publish"){let f=await W(i);if(!f){c(o,413,{ok:!1,error:"body too large"});return}let l;try{l=JSON.parse(f)}catch{c(o,400,{ok:!1,error:"invalid json"});return}let d=typeof l.channel=="string"?l.channel:"",p=typeof l.id=="string"?l.id.slice(0,80):"",g=typeof l.from=="string"?l.from.slice(0,80):"",_=typeof l.envelope?.iv=="string"?l.envelope.iv:"",y=typeof l.envelope?.ct=="string"?l.envelope.ct:"";if(!p||!g||!_||!y||y.length>64*1024){c(o,400,{ok:!1,error:"invalid message"});return}let x=O(U(i),d,"publish");if(!x.ok){s.record({event:"denied",channel:d.slice(0,32),ip:k(i),detail:x.reason}),c(o,403,{ok:!1,error:x.reason});return}let w=b?I(d):S(d,U(i));if(!w){s.record({event:"denied",channel:d.slice(0,32),ip:k(i),detail:"channel denied"}),c(o,403,{ok:!1,error:"channel denied"});return}if(w.seen.has(p)){s.record({event:"publish",channel:d,device:g,message:p,ip:k(i),detail:"duplicate"}),c(o,200,{ok:!0,duplicate:!0,seq:w.seq});return}w.seq+=1,w.seen.add(p),s.record({event:"publish",channel:d,device:g,message:p,ip:k(i),bytes:y.length}),w.seen.size>e*4&&(w.seen=new Set([...w.seen].slice(-e*2))),w.messages.push({seq:w.seq,id:p,from:g,envelope:{iv:_,ct:y},at:Date.now()}),w.messages.length>e&&(w.messages=w.messages.slice(-e));for(let N of[...w.waiters])N();c(o,200,{ok:!0,seq:w.seq});return}if(v==="/v1/presence"){let f=U(i),l=B.get("channel")??"",d;if(i.method==="POST"){let y=await W(i);if(!y){c(o,413,{ok:!1,error:"body too large"});return}let x;try{x=JSON.parse(y)}catch{c(o,400,{ok:!1,error:"invalid json"});return}l=typeof x.channel=="string"?x.channel:"",d=x.device}let p=O(f,l,"presence");if(!p.ok){s.record({event:"denied",channel:l.slice(0,32),ip:k(i),detail:p.reason}),c(o,403,{ok:!1,error:p.reason});return}let g=b?I(l):S(l,f);if(!g){c(o,403,{ok:!1,error:"channel denied"});return}if(d){let y=p.deviceId??(typeof d.id=="string"?d.id.slice(0,80):"");if(!y){c(o,400,{ok:!1,error:"invalid device"});return}g.presence.set(y,{name:p.member?`${p.member} \xB7 ${typeof d.name=="string"?d.name.slice(0,60):"\u8BBE\u5907"}`:typeof d.name=="string"?d.name.slice(0,120):y,platform:typeof d.platform=="string"?d.platform:"unknown",project:typeof d.project=="string"?d.project.slice(0,120):"",at:Date.now()})}let _=Date.now();for(let[y,x]of g.presence)_-x.at>Je&&g.presence.delete(y);c(o,200,{ok:!0,devices:[...g.presence.entries()].map(([y,x])=>({id:y,...x}))});return}c(o,404,{ok:!1,error:"not found"})})().catch(h=>{a(`[relay] \u8BF7\u6C42\u5904\u7406\u5931\u8D25\uFF1A${h instanceof Error?h.message:String(h)}`),o.writableEnded||c(o,500,{ok:!1,error:"internal error"})})});await new Promise((i,o)=>{D.once("error",o),D.listen(t.port??8787,t.host??"0.0.0.0",()=>{D.off("error",o),i()})});let A=D.address(),G=A&&typeof A=="object"?A.port:t.port??8787;return a(`[relay] \u76D1\u542C ${t.host??"0.0.0.0"}:${G}`),s.record({event:"startup",detail:`listen ${t.host??"0.0.0.0"}:${G}`}),{port:G,close:()=>new Promise(i=>{s.record({event:"shutdown"});for(let o of u.values())for(let h of[...o.waiters])h();D.close(()=>{s.flush().then(()=>i())}),setTimeout(()=>i(),1500).unref?.()})}}var Oe=require("node:dgram"),Pe=require("node:http"),De=require("node:https"),Me=require("node:net");function Re(t){let e=(t??"").trim();if(e)try{if(/^otlp\+https?:\/\//i.test(e))return{kind:"otlp",url:new URL(e.replace(/^otlp\+/i,""))};if(/^syslog\+tcp:\/\//i.test(e))return{kind:"syslog-tcp",url:new URL(e.replace(/^syslog\+tcp:/i,"http:"))};if(/^syslog:\/\//i.test(e))return{kind:"syslog",url:new URL(e.replace(/^syslog:/i,"http:"))};if(/^https?:\/\//i.test(e))return{kind:"webhook",url:new URL(e)}}catch{return}}function _e(t,e,n){let r;try{r=t}catch{return}let a=Buffer.from(e,"utf8"),u=(r.protocol==="https:"?De.request:Pe.request)(r,{method:"POST",headers:{"content-type":"application/json","content-length":String(a.length)},timeout:n},m=>{m.resume()});u.on("timeout",()=>u.destroy()),u.on("error",()=>{}),u.end(a)}function Ge(t,e){let n=`${Date.now()}000000`;try{let r=JSON.parse(t);if(typeof r.ts=="string"){let a=Date.parse(r.ts);Number.isFinite(a)&&(n=`${a}000000`)}}catch{}return JSON.stringify({resourceLogs:[{resource:{attributes:[{key:"service.name",value:{stringValue:"plaitcode-relay"}},{key:"host.name",value:{stringValue:e}}]},scopeLogs:[{scope:{name:"plaitcode.audit"},logRecords:[{timeUnixNano:n,severityText:"INFO",body:{stringValue:t}}]}]}]})}function Le(t,e={}){let n=e.hostname??"plaitcode-relay";if(t.kind==="webhook")return{send:m=>_e(t.url,m,5e3),close:()=>{}};if(t.kind==="otlp")return{send:m=>_e(t.url,Ge(m,n),5e3),close:()=>{}};let r=t.url.hostname,a=Number(t.url.port||514);if(t.kind==="syslog"){let m=(0,Oe.createSocket)("udp4");return m.on("error",()=>{}),m.unref?.(),{send:S=>{let C=`<14>1 - ${n} plaitcode-relay - AUDIT - ${S}`;try{m.send(Buffer.from(C,"utf8"),a,r,()=>{})}catch{}},close:()=>{try{m.close()}catch{}}}}let s,u=()=>(s&&!s.destroyed||(s=(0,Me.connect)(a,r,()=>{}),s.on("error",()=>{s=void 0}),s.on("close",()=>{s=void 0}),s.unref?.()),s);return{send:m=>{let S=u();if(S)try{S.write(`<14>1 - ${n} plaitcode-relay - AUDIT - ${m}
`)}catch{s=void 0}},close:()=>{try{s?.destroy()}catch{}}}}var $e=require("node:os");async function Ye(){let t=Number(process.env.PLAITCODE_PORT??8787),e=process.env.PLAITCODE_HOST??"127.0.0.1",n=process.env.PLAITCODE_AUDIT??"/var/lib/plaitcode-relay/audit.jsonl",r=process.env.PLAITCODE_AUDIT_STDOUT!=="0",a=process.env.PLAITCODE_IDENTITY?.trim(),s=process.env.PLAITCODE_ADMIN_TOKEN?.trim()??"",u=a?{state:await ge(a)??ae(),path:a}:void 0;u&&(console.log(`[relay] \u8EAB\u4EFD\u6A21\u5F0F\uFF1A${u.state.orgs.length} \u7EC4\u7EC7 / ${u.state.members.length} \u6210\u5458 / ${u.state.devices.length} \u8BBE\u5907`),s||console.log("[relay] \u8B66\u544A\uFF1A\u6CA1\u8BBE PLAITCODE_ADMIN_TOKEN\uFF0C\u7BA1\u7406\u63A5\u53E3\u4E0D\u53EF\u7528"));let m=Re(process.env.PLAITCODE_AUDIT_SINK),S=m?Le(m,{hostname:(0,$e.hostname)()}):void 0;m&&console.log(`[relay] \u5BA1\u8BA1\u5916\u9001\uFF1A${m.kind} \u2192 ${m.url.host}`);let C=process.env.PLAITCODE_FEISHU_APP_ID?.trim()??"",b=process.env.PLAITCODE_FEISHU_APP_SECRET?.trim()??"",P=process.env.PLAITCODE_AUTH_SECRET?.trim()??"",I=(process.env.PLAITCODE_PUBLIC_URL?.trim()||"https://plaitcode.com").replace(/\/+$/,""),O=C&&b?{appId:C,appSecret:b,redirectUri:`${I}/v1/auth/feishu/callback`,...process.env.PLAITCODE_FEISHU_AUTHORIZE?{endpoints:{authorize:process.env.PLAITCODE_FEISHU_AUTHORIZE}}:{},...process.env.PLAITCODE_FEISHU_TOKEN?{endpoints:{token:process.env.PLAITCODE_FEISHU_TOKEN}}:{},...process.env.PLAITCODE_FEISHU_USERINFO?{endpoints:{userinfo:process.env.PLAITCODE_FEISHU_USERINFO}}:{}}:void 0,T=O&&P&&u?{config:O,secret:P,emailDomains:(process.env.PLAITCODE_AUTH_EMAIL_DOMAINS??"").split(",").map(A=>A.trim()).filter(Boolean)}:void 0;T?console.log("[relay] \u98DE\u4E66\u767B\u5F55\u5DF2\u542F\u7528"):C&&console.log("[relay] \u8B66\u544A\uFF1A\u98DE\u4E66\u767B\u5F55\u9700\u8981 PLAITCODE_AUTH_SECRET \u4E0E\u8EAB\u4EFD\u5E93\uFF08PLAITCODE_IDENTITY\uFF09");let z=await Te({port:Number.isFinite(t)&&t>0?t:8787,host:e,log:A=>console.log(A),...u?{identity:u}:{},...s?{adminToken:s}:{},...T?{auth:T}:{},audit:{...n&&n!=="-"?{path:n}:{},sink:(A=>{r&&console.log(`[audit] ${A}`),S?.send(A)}),includeIp:process.env.PLAITCODE_AUDIT_IP!=="0",maxBytes:Number(process.env.PLAITCODE_AUDIT_MAX_BYTES??20*1024*1024),keep:Number(process.env.PLAITCODE_AUDIT_KEEP??5)}});console.log(`[relay] ready on http://${e}:${z.port}`);let D=A=>{console.log(`[relay] ${A}\uFF0C\u6B63\u5728\u5173\u95ED`),S?.close(),z.close().then(()=>process.exit(0))};process.on("SIGTERM",()=>D("SIGTERM")),process.on("SIGINT",()=>D("SIGINT"))}Ye().catch(t=>{console.error(`[relay] \u542F\u52A8\u5931\u8D25\uFF1A${t instanceof Error?t.message:String(t)}`),process.exit(1)});
