"use strict";var U=require("node:crypto"),F=require("node:http");var y=require("node:fs/promises"),H=require("node:path"),I=class{constructor(e={}){this.options=e;this.maxBytes=Math.max(4*1024,e.maxBytes??20*1024*1024),this.keep=Math.max(1,Math.min(e.keep??3,20)),this.includeIp=e.includeIp??!0}options;maxBytes;keep;includeIp;queue=Promise.resolve();written=0;record(e){let a={ts:(this.options.now?.()??new Date).toISOString(),event:e.event,...e.channel?{channel:e.channel}:{},...e.device?{device:e.device}:{},...e.message?{message:e.message}:{},...e.ip&&this.includeIp?{ip:e.ip}:{},...typeof e.bytes=="number"?{bytes:e.bytes}:{},...e.detail?{detail:e.detail}:{}},f=`${JSON.stringify(a)}
`;try{this.options.sink?.(f.trimEnd())}catch{}let l=this.options.path;l&&(this.queue=this.queue.then(()=>this.append(l,f)).catch(()=>{}))}async flush(){await this.queue.catch(()=>{})}async append(e,a){let f=Buffer.byteLength(a);this.written===0&&(this.written=await(0,y.stat)(e).then(l=>l.size).catch(()=>0)),this.written+f>this.maxBytes&&(await this.rotate(e),this.written=0),await(0,y.mkdir)((0,H.dirname)(e),{recursive:!0}).catch(()=>{}),await(0,y.appendFile)(e,a,"utf8"),this.written+=f}async rotate(e){for(let a=this.keep;a>=1;a-=1){let f=a===1?e:`${e}.${a-1}`,l=`${e}.${a}`;await(0,y.rename)(f,l).catch(()=>{})}}};var N="plaitcode/channel/1:",L="plaitcode/relay/1:",$="plaitcode/enc/1:";function j(t){return`<!doctype html>
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
    return Promise.all([digest('${N}'), digest('${L}'), digest('${$}')])
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
</html>`}var J="1",X=96*1024,W=9e4;function z(t){return(0,U.createHash)("sha256").update(t,"utf8").digest("hex")}function s(t,e,a,f={}){let l=JSON.stringify(a);t.writeHead(e,{"content-type":"application/json; charset=utf-8","content-length":Buffer.byteLength(l),"cache-control":"no-store","x-content-type-options":"nosniff",...f}),t.end(l)}function q(t){return new Promise(e=>{let a=[],f=0;t.on("data",l=>{if(f+=l.length,f>X){e(void 0),t.destroy();return}a.push(l)}),t.on("end",()=>e(Buffer.concat(a).toString("utf8"))),t.on("error",()=>e(void 0))})}function B(t){let e=t.headers.authorization??"";return/^Bearer\s+(.+)$/i.exec(e.trim())?.[1]?.trim()??""}function C(t){let e=t.headers["x-real-ip"];if(typeof e=="string"&&e.trim())return e.trim();let a=t.headers["x-forwarded-for"];return typeof a=="string"&&a.trim()?a.split(",")[0].trim():(t.socket.remoteAddress??"").replace(/^::ffff:/,"")}async function K(t={}){let e=Math.max(20,t.maxMessages??500),a=Math.max(1e3,Math.min(t.maxWaitMs??22e3,25e3)),f=Math.max(10,t.rateLimit??240),l=t.log??(()=>{}),b=new I(t.audit),S=new Map,D=new Map,A=(r,n)=>{let c=S.get(r);if(c)return c.keyHash===z(n)?c:void 0;if(!/^[0-9a-f]{16,64}$/.test(r))return;let g={keyHash:z(n),createdAt:Date.now(),seq:0,messages:[],waiters:[],seen:new Set,presence:new Map};return S.set(r,g),l(`[relay] \u65B0\u9891\u9053 ${r.slice(0,8)}\u2026`),g},G=r=>{let n=Date.now(),c=D.get(r);return!c||n>=c.resetAt?(D.set(r,{count:1,resetAt:n+6e4}),!0):(c.count+=1,c.count<=f)},k=(0,F.createServer)((r,n)=>{(async()=>{let c=r.url??"/",g=c.split("?")[0]??"/",E=new URLSearchParams(c.slice(c.indexOf("?")+1)),_=g==="/health"||g==="/";if(!(_||g==="/m")){let h=C(r);if(!G(h)){b.record({event:"denied",ip:h,detail:"rate limited"}),s(n,429,{ok:!1,error:"too many requests"});return}}if(r.method==="GET"&&g==="/m"){let h=j({relayHost:typeof r.headers.host=="string"?r.headers.host:"plaitcode.com"});n.writeHead(200,{"content-type":"text/html; charset=utf-8","content-length":Buffer.byteLength(h),"cache-control":"no-store","x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"no-referrer"}),n.end(h);return}if(r.method==="GET"&&_){s(n,200,{ok:!0,service:"plaitcode-relay",version:J,channels:S.size,uptime:Math.round(process.uptime())});return}if(!g.startsWith("/v1/")){s(n,404,{ok:!1,error:"not found"});return}if(r.method==="GET"&&g==="/v1/poll"){let h=E.get("channel")??"",d=B(r),i=A(h,d);if(!i){s(n,403,{ok:!1,error:"channel denied"});return}let m=Number(E.get("since")??0)||0,v=Math.min(Math.max(Number(E.get("wait")??20)*1e3||2e4,0),a),u=()=>i.messages.filter(x=>x.seq>m),p=u();if(p.length||v===0){s(n,200,{ok:!0,messages:p.slice(-200),seq:i.seq});return}let o=!1,w=()=>{if(o)return;o=!0;let x=i.waiters.indexOf(w);x>=0&&i.waiters.splice(x,1),clearTimeout(P),!n.writableEnded&&s(n,200,{ok:!0,messages:u().slice(-200),seq:i.seq})},P=setTimeout(w,v);P.unref?.(),i.waiters.push(w),r.on("close",()=>{if(o)return;o=!0;let x=i.waiters.indexOf(w);x>=0&&i.waiters.splice(x,1),clearTimeout(P)});return}if(r.method==="POST"&&g==="/v1/publish"){let h=await q(r);if(!h){s(n,413,{ok:!1,error:"body too large"});return}let d;try{d=JSON.parse(h)}catch{s(n,400,{ok:!1,error:"invalid json"});return}let i=typeof d.channel=="string"?d.channel:"",m=typeof d.id=="string"?d.id.slice(0,80):"",v=typeof d.from=="string"?d.from.slice(0,80):"",u=typeof d.envelope?.iv=="string"?d.envelope.iv:"",p=typeof d.envelope?.ct=="string"?d.envelope.ct:"";if(!m||!v||!u||!p||p.length>64*1024){s(n,400,{ok:!1,error:"invalid message"});return}let o=A(i,B(r));if(!o){b.record({event:"denied",channel:i.slice(0,32),ip:C(r),detail:"channel denied"}),s(n,403,{ok:!1,error:"channel denied"});return}if(o.seen.has(m)){b.record({event:"publish",channel:i,device:v,message:m,ip:C(r),detail:"duplicate"}),s(n,200,{ok:!0,duplicate:!0,seq:o.seq});return}o.seq+=1,o.seen.add(m),b.record({event:"publish",channel:i,device:v,message:m,ip:C(r),bytes:p.length}),o.seen.size>e*4&&(o.seen=new Set([...o.seen].slice(-e*2))),o.messages.push({seq:o.seq,id:m,from:v,envelope:{iv:u,ct:p},at:Date.now()}),o.messages.length>e&&(o.messages=o.messages.slice(-e));for(let w of[...o.waiters])w();s(n,200,{ok:!0,seq:o.seq});return}if(g==="/v1/presence"){let h=B(r),d=E.get("channel")??"",i;if(r.method==="POST"){let u=await q(r);if(!u){s(n,413,{ok:!1,error:"body too large"});return}let p;try{p=JSON.parse(u)}catch{s(n,400,{ok:!1,error:"invalid json"});return}d=typeof p.channel=="string"?p.channel:"",i=p.device}let m=A(d,h);if(!m){s(n,403,{ok:!1,error:"channel denied"});return}if(i){let u=typeof i.id=="string"?i.id.slice(0,80):"";if(!u){s(n,400,{ok:!1,error:"invalid device"});return}m.presence.set(u,{name:typeof i.name=="string"?i.name.slice(0,120):u,platform:typeof i.platform=="string"?i.platform:"unknown",project:typeof i.project=="string"?i.project.slice(0,120):"",at:Date.now()})}let v=Date.now();for(let[u,p]of m.presence)v-p.at>W&&m.presence.delete(u);s(n,200,{ok:!0,devices:[...m.presence.entries()].map(([u,p])=>({id:u,...p}))});return}s(n,404,{ok:!1,error:"not found"})})().catch(c=>{l(`[relay] \u8BF7\u6C42\u5904\u7406\u5931\u8D25\uFF1A${c instanceof Error?c.message:String(c)}`),n.writableEnded||s(n,500,{ok:!1,error:"internal error"})})});await new Promise((r,n)=>{k.once("error",n),k.listen(t.port??8787,t.host??"0.0.0.0",()=>{k.off("error",n),r()})});let T=k.address(),M=T&&typeof T=="object"?T.port:t.port??8787;return l(`[relay] \u76D1\u542C ${t.host??"0.0.0.0"}:${M}`),b.record({event:"startup",detail:`listen ${t.host??"0.0.0.0"}:${M}`}),{port:M,close:()=>new Promise(r=>{b.record({event:"shutdown"});for(let n of S.values())for(let c of[...n.waiters])c();k.close(()=>{b.flush().then(()=>r())}),setTimeout(()=>r(),1500).unref?.()})}}var R=Number(process.env.PLAITCODE_PORT??8787),Y=process.env.PLAITCODE_HOST??"127.0.0.1",O=process.env.PLAITCODE_AUDIT??"/var/lib/plaitcode-relay/audit.jsonl",V=process.env.PLAITCODE_AUDIT_STDOUT!=="0";K({port:Number.isFinite(R)&&R>0?R:8787,host:Y,log:t=>console.log(t),audit:{...O&&O!=="-"?{path:O}:{},...V?{sink:t=>console.log(`[audit] ${t}`)}:{},includeIp:process.env.PLAITCODE_AUDIT_IP!=="0",maxBytes:Number(process.env.PLAITCODE_AUDIT_MAX_BYTES??20*1024*1024),keep:Number(process.env.PLAITCODE_AUDIT_KEEP??5)}}).then(t=>{console.log(`[relay] ready on http://${Y}:${t.port}`);let e=a=>{console.log(`[relay] ${a}\uFF0C\u6B63\u5728\u5173\u95ED`),t.close().then(()=>process.exit(0))};process.on("SIGTERM",()=>e("SIGTERM")),process.on("SIGINT",()=>e("SIGINT"))}).catch(t=>{console.error(`[relay] \u542F\u52A8\u5931\u8D25\uFF1A${t instanceof Error?t.message:String(t)}`),process.exit(1)});
