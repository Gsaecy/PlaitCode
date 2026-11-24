/**
 * 手机端页面：直接用浏览器连**中继**（跨网络），端到端加密在浏览器里做。
 *
 * 与局域网那套（`mobileControl.ts`）的区别只在"怎么送达"：
 *  - 局域网：手机连电脑的 47821；
 *  - 跨网络：手机连 https://plaitcode.com，消息由中继转发，中继只见密文。
 *
 * 页面要拿到频道密钥才能用：密钥放在 URL 的 **fragment**（`#k=…`）里 ——
 * fragment 不会发给服务器，也不会出现在 nginx 日志里。打开后立刻写进 localStorage
 * 并把它从地址栏抹掉，避免截图/历史记录泄露。
 */

import { CHANNEL_PREFIX, ENC_PREFIX, RELAY_PREFIX } from './relayCrypto';

export function renderRelayMobilePage(options: { relayHost: string; sessionAuth?: boolean }): string {
  const host = options.relayHost.replace(/[<>&"]/g, '');
  // 身份模式下手机凭登录 Cookie 鉴权（密钥只用于解密，不再当票据用）
  const sessionAuth = options.sessionAuth === true;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f1115">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:">
<title>PlaitCode · 团队群</title>
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
  <span class="title">PlaitCode · 团队群</span>
  <span class="meta" id="meta">${host}</span>
</header>
<div class="board" id="board" style="display:none"></div>
<main id="main"><div class="empty">正在读取频道…</div></main>
<footer id="footer" style="display:none">
  <div class="controls" id="controls"></div>
  <div class="assign" id="assign"></div>
  <textarea id="input" rows="1" placeholder="以甲方身份说一句话（Enter 发送）"></textarea>
  <button class="primary" id="send">发送</button>
</footer>
<script>
(function () {
  var KEY_STORE = 'plaitcode.relay.key';
  var SESSION_AUTH = ${sessionAuth ? 'true' : 'false'};
  var PHASES = { requirement:'需求', analysis:'解析', question:'追问', answer:'回复', confirm:'确认', progress:'进度', result:'结果', blocked:'未执行' };
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
    return Promise.all([digest('${CHANNEL_PREFIX}'), digest('${RELAY_PREFIX}'), digest('${ENC_PREFIX}')])
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
      device: { id: deviceId, name: '手机 · 浏览器', platform: 'android', project: 'mobile' }
    }).then(function (result) {
      if (Array.isArray(result.devices)) {
        meta.textContent = (result.devices.length || 1) + ' 台设备在线';
        // 手机只是"甲方"，真正的执行者是那些电脑：列出除自己以外的设备供指派
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
    var label = el('span', 'label', '由谁执行');
    box.appendChild(label);
    function chip(id, text) {
      var node = el('button', 'chip' + (chosen === id ? ' on' : ''), text);
      node.type = 'button';
      node.onclick = function () { chosen = id; renderAssign(); };
      box.appendChild(node);
    }
    chip('', '自动（谁在线谁做）');
    devices.forEach(function (device) {
      var name = device.name || device.id;
      chip(device.id, name + (device.project ? ' · ' + device.project : ''));
    });
  }

  function projectOf(id) {
    var hit = devices.filter(function (item) { return item.id === id; })[0];
    return hit && hit.project ? hit.project : '';
  }

  var STATUS_LABEL = { question:'等你回复', blocked:'未执行', running:'进行中', open:'待接', done:'已完成' };  var STATUS_ORDER = ['question', 'blocked', 'running', 'open', 'done'];
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
    box.appendChild(el('div', 'head', '任务看板 · ' + tasks.length + ' 条'));
    var cols = el('div', 'cols');
    STATUS_ORDER.forEach(function (status) {
      var group = tasks.filter(function (task) { return task.status === status; });
      if (!group.length) return;
      var col = el('div', 'col');
      col.appendChild(el('b', null, STATUS_LABEL[status] + ' · ' + group.length));
      group.forEach(function (task) {
        var card = el('div', 'card');
        card.appendChild(el('div', null, task.title));
        var who = task.assignee
          ? (devices.filter(function (item) { return item.id === task.assignee; })[0] || {}).name || '已指派'
          : '未指派';
        var metaLine = [task.project, who].filter(Boolean).join(' · ');
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
      banner.appendChild(el('b', null, '乙方在等你回答'));
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
      var who = mine ? '你' : ((message.from && message.from.name) || '乙方');
      var time = new Date(message.at || Date.now());
      line.appendChild(el('span', null, who + ' · ' + ('0' + time.getHours()).slice(-2) + ':' + ('0' + time.getMinutes()).slice(-2)));
      bubble.appendChild(line);
      bubble.appendChild(el('div', null, message.body));
      wrap.appendChild(bubble);
      main.appendChild(wrap);
    });
    if (!main.childNodes.length) main.appendChild(el('div', 'empty', '还没有发言。说一句需求，频道里的乙方都会收到。'));
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
  /** 电脑上真实生效的设置（由电脑广播过来，不是手机猜的）。 */
  var remote = { preset: '', steps: 0, running: false };

  var PRESETS = [
    { id:'askAll', label:'每次询问' },
    { id:'review', label:'只审核变更' },
    { id:'autopilot', label:'自动执行' },
    { id:'full', label:'完全访问' }
  ];

  /** 发一条控制指令给电脑（改档位 / 改步数 / 停止 / 查状态）。 */
  function sendControl(payload) {
    var messageId = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var message = Object.assign({
      kind: 'control', id: messageId, at: Date.now(),
      from: { id: deviceId, name: '手机 · 浏览器', platform: 'android', project: 'mobile', version: 'web' }
    }, payload);
    return seal(messageId, JSON.stringify(message))
      .then(function (envelope) { return post('/v1/publish', { channel: keys.channel, id: messageId, from: deviceId, envelope: envelope }); })
      .then(function (result) {
        if (!result.ok) { alert(result.error || '没发出去'); return false; }
        return true;
      });
  }

  function renderControls() {
    var box = document.getElementById('controls');
    box.textContent = '';
    box.appendChild(el('span', 'label', '权限'));
    PRESETS.forEach(function (preset) {
      var chip = el('button', 'chip' + (remote.preset === preset.id ? ' on' : ''), preset.label);
      chip.type = 'button';
      chip.onclick = function () {
        if (remote.preset === preset.id) return;
        // 先乐观显示，电脑回传的真实值会覆盖（企业策略可能把它收紧）
        remote.preset = preset.id;
        renderControls();
        sendControl({ action: 'preset', preset: preset.id });
      };
      box.appendChild(chip);
    });
    box.appendChild(el('span', 'label', '步数'));
    [12, 24, 48].forEach(function (steps) {
      var chip = el('button', 'chip' + (remote.steps === steps ? ' on' : ''), String(steps));
      chip.type = 'button';
      chip.onclick = function () { sendControl({ action: 'steps', steps: steps }); };
      box.appendChild(chip);
    });
    if (remote.running) {
      var stop = el('button', 'chip stop', '停止执行');
      stop.type = 'button';
      stop.onclick = function () {
        if (!confirm('要中止电脑上正在跑的任务吗？')) return;
        sendControl({ action: 'stop' });
      };
      box.appendChild(stop);
    }
  }

  /** 电脑广播过来的真实状态。 */
  function acceptControl(message) {
    if (message.action !== 'state') return;
    remote = {
      preset: message.preset || '',
      steps: message.steps || 0,
      running: message.running === true,
    };
    renderControls();
  }

  /** 收到的授权卡；phase=decision 表示别人已经处理，撤掉本地这张。 */
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

  /** 超过 3 分钟的卡不再显示（电脑端也早就自动拒绝了）。 */
  function freshApprovals() {
    var now = Date.now();
    approvals = approvals.filter(function (item) { return now - (item.at || 0) < APPROVAL_TTL_MS; });
    return approvals;
  }

  /** 在手机上点「允许 / 拒绝」：把决定加密送回电脑，电脑据此结算。 */
  function decide(id, allow, button) {
    button.disabled = true;
    var messageId = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var message = {
      kind: 'approval', id: id, phase: 'decision', allow: allow, at: Date.now(),
      title: '', summary: '', detail: '', risk: 'read',
      from: { id: deviceId, name: '手机 · 浏览器', platform: 'android', project: 'mobile', version: 'web' }
    };
    seal(messageId, JSON.stringify(message))
      .then(function (envelope) { return post('/v1/publish', { channel: keys.channel, id: messageId, from: deviceId, envelope: envelope }); })
      .then(function (result) {
        if (!result.ok) { alert(result.error || '没发出去'); button.disabled = false; return; }
        approvals = approvals.filter(function (item) { return item.id !== id; });
        signature = '';
        render({ connected:true, messages: messages, question: questionFor(messages) });
      })
      .catch(function () { alert('网络没连上'); button.disabled = false; });
  }

  function renderApprovals() {
    freshApprovals().forEach(function (approval) {
      var risky = approval.risk === 'command' || approval.risk === 'dangerous';
      var card = el('div', 'approval' + (risky ? '' : ' safe'));
      card.appendChild(el('div', 'title', approval.title || '需要你批准'));
      card.appendChild(el('div', 'detail', (approval.summary || '') + (approval.detail ? '\\n' + approval.detail : '')));
      var row = el('div', 'row');
      var deny = el('button', 'deny', '拒绝');
      deny.onclick = function () { decide(approval.id, false, deny); };
      var allow = el('button', 'allow', '允许');
      allow.onclick = function () { decide(approval.id, true, allow); };
      row.appendChild(deny);
      row.appendChild(allow);
      card.appendChild(row);
      main.appendChild(card);
    });
  }

  function poll() {
    if (busy) return;
    busy = true;
    var url = '/v1/poll?channel=' + encodeURIComponent(keys.channel) + '&since=' + since + '&wait=20';
    fetch(url, { credentials:'same-origin', headers: authHeaders() })
      .then(function (r) {
        if (r.status === 401) throw new Error(SESSION_AUTH ? '登录已过期，请重新用飞书登录' : '需要登录才能看这个频道');
        if (r.status === 403) throw new Error(SESSION_AUTH ? '没有这个频道的权限（找管理员授权设备）' : '频道密钥不对');
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
      from: { id: deviceId, name: '手机 · 浏览器', platform: 'android', project: 'mobile', version: 'web' }
    };
    // 指派：说清让哪台电脑做，避免每台都跑一遍、改动互相覆盖
    if (chosen) {
      message.assignee = chosen;
      var targetProject = projectOf(chosen);
      if (targetProject) message.project = targetProject;
    }
    seal(id, JSON.stringify(message))
      .then(function (envelope) { return post('/v1/publish', { channel: keys.channel, id: id, from: deviceId, envelope: envelope }); })
      .then(function (result) {
        if (!result.ok) { input.value = text; alert(result.error || '没发出去'); return; }
        messages.push(message);
        signature = '';
        render({ connected:true, messages: messages, question: questionFor(messages) });
      })
      .catch(function () { input.value = text; alert('网络没连上'); })
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
    form.appendChild(el('h1', null, '加入团队群'));
    form.appendChild(el('p', null, '把电脑上「PlaitCode: 手机加入频道」显示的二维码扫一下，或粘贴那一整条配对信息。'));
    var field = document.createElement('input');
    field.placeholder = 'plaitcode://join?u=https://…&s=…';
    field.autocomplete = 'off';
    form.appendChild(field);
    var submitBtn = el('button', 'primary', '进入');
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
      if (key.length < 16) { err.textContent = '这条配对信息看不懂，重新扫一次二维码。'; return; }
      localStorage.setItem(KEY_STORE, key);
      boot(key);
    });
  }

  function boot(candidate) {
    secret = candidate;
    history.replaceState(null, '', location.pathname);
    say('正在连接…');
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
      // 连上就问一次电脑的真实设置：否则界面上的权限/步数是空的
      setTimeout(function () { sendControl({ action: 'state' }); }, 800);
      renderControls();
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) { sendControl({ action: 'state' }); poll(); }
      });
    }).catch(function () { say('浏览器不支持 WebCrypto，无法加密'); });
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
</html>`;
}
