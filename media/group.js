/**
 * 团队群窗口的界面脚本。
 *
 * 为什么从 `src/views/groupPanel.ts` 的内联 `<script>` 里搬出来：
 * 内联脚本没有挂载入口，测试只能「读源码 + 正则」——源码改个写法就红、行为坏了却可能绿。
 * 现在是真文件，可以用 DOM（linkedom）挂起来直接验行为（见 `src/test/groupPanelDom.test.ts`）。
 */
const vscode = acquireVsCodeApi();
/* 富文本模块要往宿主发消息（复制代码 / 打开链接）；webview 里只有 vscode.postMessage 能到宿主机。 */
window.HwPost = function (message) { vscode.postMessage(message); };
const el = (id) => document.getElementById(id);
const feed = el('feed'), members = el('members'), status = el('status'), sub = el('sub');
const banner = el('banner'), bannerText = el('bannerText'), text = el('text');
/**
 * 「等你回答」提醒上的 ×：只在本机收起这条提醒。
 *
 * 用户 2026-11-24：「这种弹出提示也需要增加关闭按钮，不想回答，
 * 或另外有安排，就不用一直显示占空间」。
 */
const bannerClose = el('bannerClose');
if (bannerClose) {
  bannerClose.addEventListener('click', function () {
    const question = lastState && lastState.openQuestion;
    dismissedQuestion = question
      ? (typeof question === 'string' ? question : [question.requirementId, question.body].join('|'))
      : '';
    banner.style.display = 'none';
  });
}
/** 最近一次渲染的状态：@ 候选和正文解析都要用。 */
let lastState = null;

/**
 * 设备 id → 稳定色相（0–359）。
 *
 * 用 djb2 散列而不是随机：同一台设备每次打开、在对方窗口里，都必须是同一个颜色，
 * 否则「颜色」本身就成了新的混乱来源。
 */
function hueOf(id) {
  const text = String(id || 'unknown');
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  // 避开红/橙靠得太近的一段，让相邻色相的设备也容易分辨
  const hue = hash % 300;
  return hue < 15 ? hue + 300 : hue;
}

function avatar(who, side, device) {
  const node = document.createElement('div');
  node.className = 'avatar ' + side;
  const id = device && device.id ? device.id : '';
  node.style.setProperty('--hue', String(hueOf(id)));
  if (device && device.isLocal) node.classList.add('local');
  // 角色固定：用户=甲方，agent=乙方。不按平台取首字母，否则每个方块都是 W/M。
  node.textContent = side === 'user' ? '甲' : '乙';
  node.title = device && device.name ? device.name + (device.isLocal ? '（本机）' : '') : '';
  return node;
}

let boardCollapsed = true;
/** 邀请码默认收起（等对方加入时展开一次，之后不占地方）。 */
let inviteCollapsed = false;
/** 群信息（成员 / 操作 / 项目 / 邀请码）默认收起：只留一行摘要。 */
let drawerOpen = false;
/** 被收起的那条「等你回答」提醒（只影响本机显示，不影响问题本身）。 */
let dismissedQuestion = '';
function paintInvite() {
  el('invite').classList.toggle('collapsed', inviteCollapsed);
}

/* ---------------- 复制整条消息（文字 + 全部附件） ----------------
 *
 * 用户 2026-11-25：「气泡消息复制只能第一张附件/图……需要能复制全部附件/图 + 消息内容。
 * 团队群聊里面也需要实现这个功能」。
 *
 * 剪贴板一次只能放一张 image/png，但 text/html 可以内联任意多张 data URL，
 * 所以：纯文本里放正文 + 附件清单（名称与路径），HTML 里放全部图片。
 * 图片字节由宿主按资产 id 读回（面板拿不到文件系统）。
 */
var assetDataWaiters = {};
var assetDataSeq = 0;
function requestAssetData(id) {
  return new Promise(function (resolve) {
    if (!id) { resolve(null); return; }
    var requestId = 'asset-' + Date.now() + '-' + (++assetDataSeq);
    var timer = setTimeout(function () { delete assetDataWaiters[requestId]; resolve(null); }, 5_000);
    assetDataWaiters[requestId] = { resolve: resolve, timer: timer };
    vscode.postMessage({ type: 'requestAssetData', requestId: requestId, id: id });
  });
}
function finishAssetData(data) {
  var waiter = assetDataWaiters[data.requestId];
  if (!waiter) return;
  delete assetDataWaiters[data.requestId];
  clearTimeout(waiter.timer);
  waiter.resolve(data.ok && data.dataBase64 ? data : null);
}
/** 非 PNG 的图片先转 PNG：ClipboardItem 只认 image/png。 */
function toPngBlob(mimeType, dataBase64) {
  var mime = String(mimeType || 'image/png').toLowerCase();
  var bytes = Uint8Array.from(atob(dataBase64), function (ch) { return ch.charCodeAt(0); });
  var source = new Blob([bytes], { type: mime });
  if (mime === 'image/png') return Promise.resolve(source);
  return createImageBitmap(source).then(function (bitmap) {
    var canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    var context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    if (bitmap.close) bitmap.close();
    return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); });
  }).catch(function () { return null; });
}
function blobToDataUrl(blob) {
  return new Promise(function (resolve) {
    var reader = new FileReader();
    reader.onload = function () { resolve(String(reader.result || '')); };
    reader.onerror = function () { resolve(''); };
    reader.readAsDataURL(blob);
  });
}
function groupCopyHtml(text, images) {
  var escape = function (value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  var parts = [];
  if (text) parts.push('<pre style="white-space:pre-wrap;font-family:inherit">' + escape(text) + '</pre>');
  images.forEach(function (image) {
    if (!image.dataUrl) { parts.push('<p>[图片] ' + escape(image.name) + '</p>'); return; }
    parts.push('<p><img src="' + image.dataUrl + '" alt="' + escape(image.name) + '" style="max-width:100%"></p>');
    if (image.path) parts.push('<p style="font-size:12px;color:#888">' + escape(image.path) + '</p>');
  });
  return parts.join('\n');
}
function flashCopy(button, label) {
  if (!button) return;
  var idle = button.textContent;
  button.textContent = label;
  button.disabled = true;
  setTimeout(function () {
    if (!button.isConnected) return;
    button.textContent = idle;
    button.disabled = false;
  }, 1_400);
}
async function copyGroupMessage(button, line) {
  var assets = line.assets || [];
  var text = line.full || line.body || '';
  var manifest = assets.map(function (asset) {
    var kind = asset.kind === 'image' ? '图片' : '文件';
    return '[' + kind + '] ' + asset.name + (asset.path ? '：' + asset.path : '');
  }).join('\n');
  var plain = [text, manifest].filter(Boolean).join('\n\n');
  if (!plain) return;
  var images = [];
  for (var i = 0; i < assets.length; i += 1) {
    if (assets[i].kind !== 'image') continue;
    var data = await requestAssetData(assets[i].id);
    if (!data) continue;
    var png = await toPngBlob(data.mimeType, data.dataBase64);
    if (!png) continue;
    images.push({
      name: assets[i].name,
      path: assets[i].path || '',
      dataUrl: await blobToDataUrl(png)
    });
  }
  var written = false;
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard && navigator.clipboard.write) {
    try {
      var entries = {
        'text/plain': new Blob([plain], { type: 'text/plain' }),
        'text/html': new Blob([groupCopyHtml(text, images)], { type: 'text/html' })
      };
      if (images.length && images[0].dataUrl) {
        var response = await fetch(images[0].dataUrl);
        entries['image/png'] = await response.blob();
      }
      await navigator.clipboard.write([new ClipboardItem(entries)]);
      written = true;
    } catch (ignored) { written = false; }
  }
  if (!written) vscode.postMessage({ type: 'copyText', text: plain });
  flashCopy(button, written && images.length ? '已复制（含图）' : '已复制');
}
function paintDrawer() {
  el('drawer').style.display = drawerOpen ? 'block' : 'none';
  el('moreBtn').classList.toggle('on', drawerOpen);
}
/** 当前选中的执行设备；null = 所有人（旧行为）。 */
let assignee = null;
/** 当前输入框开头的 @ 前缀（用于判断用户是否手动删掉了它）。 */
let lastPrefix = '';
/**
 * 设备名里的 @ token。
 *
 * 设备名可能带空格、间隔号（「192.168.0.8 · darwin」「郭宏宇的Mac mini」），
 * 直接塞进 @xxx 会断在第一个空格。这里只取第一段并去掉所有空白 / 间隔号。
 */
function baseMentionToken(name) {
  const first = String(name || '').split('·')[0];
  return first.replace(/[\s·•]+/g, '').trim();
}

/**
 * 组里每台设备的 @ 目标（唯一 token + 可读标识）。
 *
 * **token 必须唯一**：两台设备同名（都叫 DESKTOP）时用设备号短码区分，
 * 否则 @ 其中一台会命中另一台。这是所有用户都可能遇到的通用问题，
 * 不能只按某两台机器的名字做特判。
 */
function mentionTargets(source) {
  const peers = Array.isArray(source)
    ? source
    : ((lastState && Array.isArray(lastState.peers)) ? lastState.peers : []);
  const bases = peers.map(function (peer) { return baseMentionToken(peer.name); });
  const counts = {};
  bases.forEach(function (token) { counts[token] = (counts[token] || 0) + 1; });
  return peers.map(function (peer, index) {
    const base = bases[index] || String(peer.id || '').slice(0, 6);
    const token = counts[base] > 1 && peer.id ? base + '-' + String(peer.id).slice(0, 4) : base;
    return {
      id: peer.id,
      name: peer.name,
      label: peer.label || peer.name,
      isLocal: peer.isLocal,
      token: token
    };
  });
}

/** 「由谁执行」对应的 @ 前缀：没选就是所有人。 */
function prefixFor(target) {
  if (!target) return '@所有人 ';
  const match = mentionTargets().find(function (item) { return item.id === target.id; });
  const token = target.token || (match && match.token) || baseMentionToken(target.name);
  return '@' + token + ' ';
}
/**
 * 把输入框开头的 @ 前缀换成当前选中的设备。
 *
 * 用户要求：选中 A 再去打字，输入框就显示 @A；选中 B 就显示 @B；没选就是 @所有人。
 * 只改开头那一段，后面的正文原样保留。
 */
function syncPrefixToAssignee(target) {
  const prefix = prefixFor(target);
  const rest = text.value.replace(/^@[^\s@]*\s*/, '');
  text.value = prefix + rest;
  lastPrefix = prefix;
  autosize();
  const caret = text.value.length;
  // 有些环境（测试用的轻量 DOM）没有 setSelectionRange，别让它把整个渲染打断。
  if (typeof text.setSelectionRange === 'function') text.setSelectionRange(caret, caret);
}

/*
 * @ 选择设备。
 *
 * 用户要求：输入 @ 弹出选项；不选继续输入或删掉 @ 就消失；
 * 选中就只让那台执行；不选 = 所有人（旧行为）。
 */
let mentionItems = [];
let mentionIndex = 0;
let mentionStart = -1;
function mentionCandidates(query) {
  // @ 候选与「由谁执行」同源：都用 mentionTargets()，token 唯一。
  const all = [{ id: null, name: '所有人', label: '所有人', token: '所有人' }].concat(mentionTargets());
  const q = String(query || '').toLowerCase();
  return all.filter(function (item) {
    return !q || String(item.name).toLowerCase().indexOf(q) >= 0
      || String(item.label).toLowerCase().indexOf(q) >= 0
      || String(item.token).toLowerCase().indexOf(q) >= 0;
  });
}
function paintMention() {
  const box = el('mention');
  if (!mentionItems.length) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  box.textContent = '';
  mentionItems.forEach(function (item, index) {
    const row = document.createElement('div');
    row.className = 'item' + (index === mentionIndex ? ' on' : '');
    row.textContent = item.label || item.name;
    const tag = document.createElement('small');
    tag.textContent = item.id === null ? '全部设备' : (item.isLocal ? '本机' : '队友');
    row.appendChild(tag);
    row.addEventListener('mousedown', function (event) {
      event.preventDefault();
      chooseMention(item);
    });
    box.appendChild(row);
  });
}
function closeMention() {
  mentionItems = [];
  mentionStart = -1;
  el('mention').style.display = 'none';
}
function chooseMention(item) {
  if (mentionStart < 0) return;
  const before = text.value.slice(0, mentionStart);
  const after = text.value.slice(text.selectionStart);
  const inserted = item.id === null ? '@所有人 ' : '@' + item.token + ' ';
  text.value = before + inserted + after;
  assignee = item.id === null ? null : { id: item.id, name: item.name, token: item.token };
  lastPrefix = inserted;
  closeMention();
  if (typeof text.focus === 'function') text.focus();
  const caret = (before + inserted).length;
  if (typeof text.setSelectionRange === 'function') text.setSelectionRange(caret, caret);
  autosize();
}
/** 光标前是不是一个「刚落下的 @」；是就开列表。 */
function syncMention() {
  const caret = text.selectionStart;
  const before = text.value.slice(0, caret);
  const at = before.lastIndexOf('@');
  // 删掉 @ 或者 @ 后面有空格 → 关掉（用户要求：不选继续输入就消失）
  if (at < 0) { closeMention(); return; }
  const prevOk = at === 0 || /\s/.test(before[at - 1]);
  const query = before.slice(at + 1);
  if (!prevOk || /\s/.test(query)) { closeMention(); return; }
  mentionStart = at;
  mentionItems = mentionCandidates(query);
  mentionIndex = 0;
  paintMention();
}
/**
 * 句首的 @某台 就是指派对象。
 *
 * 用户实况（2026-11-25）：输入框里明明是 「@郭宏宇的Macmini」（设备名是
 * 「郭宏宇的Mac mini」），发送时却匹配不上，退回「所有人」/ 正在追问的那台，
 * 于是 Windows 收到并开跑。
 *
 * 所以比较前**两边都去掉空白**（mentionTargets 插入的 token 本身就没有空格），
 * 先精确匹配设备名 / 统一标识；前缀命中必须唯一，多台都对得上就不猜。
 */
function mentionAssignee(value) {
  const match = String(value || '').match(/^@([^\s@]+)/);
  if (!match) return null;
  const norm = function (text) {
    return String(text || '').replace(/[\s·•]+/g, '').toLowerCase();
  };
  const wanted = norm(match[1]);
  if (!wanted || wanted === '所有人') return null;
  const targets = mentionTargets();
  const pick = function (item) { return { id: item.id, name: item.name, token: item.token }; };
  // 1) 面板插入的 token 精确命中（唯一，不会串台）
  const byToken = targets.find(function (item) { return norm(item.token) === wanted; });
  if (byToken) return pick(byToken);
  // 2) 完整设备名 / 统一标识（去掉空白与间隔号后）精确命中。
  //    两台同名时都算命中 —— 这时**不猜**，退回「由谁执行」的选择。
  const exactHits = targets.filter(function (item) {
    return norm(item.name) === wanted || norm(item.label) === wanted;
  });
  if (exactHits.length === 1) return pick(exactHits[0]);
  if (exactHits.length > 1) return null;
  // 3) 唯一的前缀命中；多台都对得上同样不猜。
  const prefixHits = targets.filter(function (item) {
    return norm(item.name).indexOf(wanted) >= 0 || norm(item.label).indexOf(wanted) >= 0;
  });
  return prefixHits.length === 1 ? pick(prefixHits[0]) : null;
}
function renderBoard(groups) {
  const board = el('board'), cols = el('boardCols'), hint = el('boardHint');
  const total = groups.reduce((sum, group) => sum + group.tasks.length, 0);
  if (!total) { board.style.display = 'none'; return; }
  board.style.display = 'block';
  board.classList.toggle('open', !boardCollapsed);
  el('boardHead').onclick = () => {
    boardCollapsed = !boardCollapsed;
    board.classList.toggle('open', !boardCollapsed);
    paintHint();
  };
  function paintHint() {
    const counts = groups.map(function (group) { return group.label + ' ' + group.tasks.length; }).join(' · ');
    hint.textContent = boardCollapsed ? counts : total + ' 条（点击标题折叠）';
  }
  paintHint();
  cols.textContent = '';
  for (const group of groups) {
    const col = document.createElement('div');
    col.className = 'board-col';
    const headNode = document.createElement('b');
    headNode.textContent = group.label + ' · ' + group.tasks.length;
    col.appendChild(headNode);
    for (const task of group.tasks) {
      const card = document.createElement('div');
      card.className = 'task';
      const title = document.createElement('div');
      title.className = 't';
      title.textContent = task.title;
      card.appendChild(title);
      const meta = document.createElement('div');
      meta.className = 'm';
      const parts = [];
      if (task.project) parts.push(task.project);
      parts.push(task.assigneeName ? '指派：' + task.assigneeName : '全部设备');
      meta.textContent = parts.join(' · ');
      card.appendChild(meta);
      if (task.lastLine) {
        const last = document.createElement('div');
        last.className = 'm';
        last.textContent = task.lastLine;
        card.appendChild(last);
      }
      col.appendChild(card);
    }
    cols.appendChild(col);
  }
}

function render(state) {
  lastState = state;
  // 第一次渲染时给输入框写上默认的 @所有人（用户要求：默认就显示 @内容）。
  if (!text.dataset.prefixed) {
    text.dataset.prefixed = '1';
    if (!text.value.trim()) syncPrefixToAssignee(assignee);
  }
  const head = state.header || { status: '未连接', sub: '', on: false };
  status.textContent = head.status;
  status.classList.toggle('on', head.on);
  sub.textContent = head.sub;
  /*
   * 一行摘要：成员 + 项目，超长省略。
   *
   * 详细的成员卡、四个操作按钮、项目框、邀请码都在「群信息」里展开看 ——
   * 之前它们全摊在顶部，把对话区挤得只剩一条缝。
   */
  const names = state.peers.map((peer) => peer.name).join('、');
  /*
   * 摘要里先写项目名，再写仓库 ID —— 只写仓库 ID 会和「群信息」里的名字对不上，
   * 看起来像两套说法。
   */
  const projectBit = state.projectName
    ? (state.projectRepo ? state.projectName + '（' + state.projectRepo + '）' : state.projectName)
    : '';
  el('peek').textContent = [names, projectBit].filter(Boolean).join('  ·  ');
  paintDrawer();

  /*
   * 邀请码：主机才显示，一直挂在窗口顶部。
   *
   * 用户之前只能在「右下角一闪而过」的通知里看到它，错过就得重开群（码会变）。
   * 这里同时给出可复制的整串（带地址），对方粘贴即可，不依赖广播。
   */
  if (state.projectRows && state.projectRows.length) {
    const rows = el('projectRows');
    rows.textContent = '';
    for (const row of state.projectRows) {
      const line = document.createElement('div');
      line.className = 'prow';
      const who = document.createElement('span');
      who.className = 'pwho';
      who.textContent = row.isLocal ? row.device + '（本机）' : row.device;
      const name = document.createElement('span');
      name.className = 'pname';
      name.textContent = row.project || '（未选）';
      const repo = document.createElement('span');
      repo.className = 'how';
      repo.textContent = row.repo || '未绑定 GitHub 仓库';
      line.appendChild(who); line.appendChild(name); line.appendChild(repo);
      rows.appendChild(line);
    }
    el('projectBox').style.display = 'block';
  } else {
    el('projectBox').style.display = 'none';
  }
  /*
   * 项目对不上时**必须醒目**。
   *
   * 真机踩过：Windows 在做 deepseek-hwchat、mac 在做 personal_workstation，
   * 两台都显示「群聊中 · 2 台设备」，看着一切正常，但任务一律被门禁拦下 ——
   * 用户只会觉得「根本没法执行任务」。
   */
  const versionWarn = el('versionWarn');
  if (state.versionWarning) {
    versionWarn.style.display = 'block';
    versionWarn.textContent = '版本不一致：' + state.versionWarning;
  } else {
    versionWarn.style.display = 'none';
  }

  const warn = el('projectWarn');
  if (state.projectMismatch) {
    warn.style.display = 'block';
    warn.textContent = '两台在做不同的项目：' + state.projectMismatch
      + '。在群里说话照常能听到、照常能回；只有「会改代码」的任务需要先对齐项目。';
  } else {
    warn.style.display = 'none';
  }

  const inviteBox = el('invite');
  const inviteText = state.inviteText || '';
  if (inviteText) {
    inviteBox.style.display = 'block';
    el('inviteCode').textContent = state.invite || '';
    el('inviteHow').textContent = state.inviteWaiting
      ? '正在等对方填码…（点「复制邀请码」把整串发给对方）'
      : '';
    inviteBox.dataset.text = inviteText;
    /*
     * 已经有人加入了就自动收起：这时邀请码没用了，不该继续占地方。
     * 用户也可以点标题自己展开/收起。
     */
    if (!state.inviteWaiting) inviteCollapsed = true;
    paintInvite();
  } else {
    inviteBox.style.display = 'none';
  }

  members.textContent = '';
  for (const peer of state.peers) {
    const node = document.createElement('div');
    node.className = 'member';
    node.appendChild(avatar(peer.label || peer.name, 'agent', peer));
    const label = document.createElement('span');
    /*
     * 统一身份标识：系统类型 · 设备名（两台同名时自动带 IP）。
     * 以前这里直接显示 peer.name，一台是「Windows」、另一台是「MagicBookV14 · win32」，
     * 看不出是同一种东西，两台都是 Windows 时更分不清。
     */
    label.textContent = peer.label || peer.name;
    /*
     * 每台设备上都有一位甲方（用户）和一个乙方（agent）。
     * 标清角色，用户才不会以为另一台只有"一台机器"在跟他协作。
     */
    const tag = document.createElement('small');
    tag.textContent = peer.isLocal ? '本机 · 甲方(你) + 乙方' : '队友 · 甲方 + 乙方';
    node.appendChild(label);
    node.appendChild(tag);
    members.appendChild(node);
  }

  /*
   * 追问提示条：**写清是哪台在问**，并给出可点的现成答案 + 自定义回答。
   *
   * 点选项 = 直接发出这条回答，而且只回给问话的那台（assignee），
   * 不会让群里其它 agent 也收到一份回答去重复执行。
   */
  const question = state.openQuestion;
  /*
   * 关掉的是**这条提醒**，不是把问题撤掉。
   *
   * 用户 2026-11-24：「这种弹出提示也需要增加关闭按钮，不想回答，或另外有安排，
   * 就不用一直显示占空间」。所以只在本机收起；同一台再提新问题
   * （正文变了）会重新弹出来，别人那台也不受影响。
   */
  const signature = question
    ? (typeof question === 'string' ? question : [question.requirementId, question.body].join('|'))
    : '';
  if (question && dismissedQuestion !== signature) {
    const info = typeof question === 'string' ? { body: question, askerLabel: '', options: [] } : question;
    banner.style.display = 'block';
    const whoNode = el('bannerWho');
    if (whoNode) whoNode.textContent = info.askerLabel
      ? info.askerLabel + ' 的乙方在等你回答'
      : '乙方在等你回答';
    /*
     * 正文压成可读的预览：去掉 markdown 记号（井号标题、加粗星号、表格竖线、反引号），
     * 再交给 CSS 截到三行 —— agent 那种「我的理解 + 证据表 + 待办」的整段，
     * 原样铺开会占满整个窗口，反而看不到群里的对话。
     */
    bannerText.textContent = bannerPreview(info.body);
    bannerText.classList.remove('open');
    const more = el('bannerMore');
    if (more) {
      const long = String(info.body || '').length > 120;
      more.style.display = long ? 'inline-block' : 'none';
      more.textContent = '展开全文';
      more.onclick = function () {
        const open = bannerText.classList.toggle('open');
        more.textContent = open ? '收起' : '展开全文';
      };
    }
    const opts = el('bannerOpts');
    if (opts) {
      opts.textContent = '';
      (info.options || []).forEach(function (option) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = option;
        button.addEventListener('click', function () {
          vscode.postMessage({
            type: 'send',
            text: option,
            assignee: info.askerId ? { id: info.askerId, name: info.askerLabel || info.askerId } : undefined
          });
        });
        opts.appendChild(button);
      });
      opts.style.display = (info.options || []).length ? 'flex' : 'none';
    }
    const hintNode = el('bannerHint');
    if (hintNode) hintNode.textContent = (info.options || []).length
      ? '点一个答案直接发送；也可以在下面输入自己的回答（同样只回给这一台）。'
      : '在下面输入回答即可，只会发给提问的这一台。';
  } else {
    banner.style.display = 'none';
  }

  renderBoard(state.taskGroups || []);
  renderAssign(state);
  renderAgentStatus(state.statuses || []);

  feed.textContent = '';
  let lastRequirement = '';
  for (const line of state.lines) {
    if (line.phaseKey === 'requirement' && line.requirementId !== lastRequirement) {
      lastRequirement = line.requirementId;
      const divider = document.createElement('div');
      divider.className = 'divider';
      divider.textContent = '需求 ' + String(line.requirementId || '').slice(0, 12);
      feed.appendChild(divider);
    }
    const row = document.createElement('div');
    row.className = 'msg ' + line.side;
    row.appendChild(avatar(line.who, line.side, line.device));
    const bubble = document.createElement('div');
    bubble.className = 'bubble ' + line.phaseKey;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const tag = document.createElement('span');
    tag.className = 'tag ' + line.phaseKey;
    tag.textContent = line.phase;
    const who = document.createElement('span');
    who.textContent = line.who;
    const time = document.createElement('span');
    time.textContent = line.time;
    meta.appendChild(tag); meta.appendChild(who);
    /*
     * 指派对象直接写在气泡上（@设备）。
     *
     * 用户实况（2026-11-25）：输入框 @ 的是 macOS，气泡里却显示成了 Windows ——
     * 发出去到底给谁，必须能在同一条气泡上核对，而不是靠猜。
     */
    if (line.assigneeLabel) {
      const target = document.createElement('span');
      target.className = 'assignee';
      target.textContent = '@' + line.assigneeLabel;
      target.title = '这条指派给 ' + line.assigneeLabel;
      meta.appendChild(target);
    }
    meta.appendChild(time);
    /*
     * 复制整条消息（文字 + 全部附件）。
     *
     * 用户 2026-11-25：「hwchat 普通对话框，气泡消息复制只能第一张附件/图，很不方便，
     * 需要能复制全部附件/图 + 消息内容。团队群聊里面也需要实现这个功能」。
     */
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'msg-copy';
    copyButton.textContent = '复制';
    copyButton.title = '复制这条消息（含全部附件）';
    copyButton.addEventListener('click', function () { void copyGroupMessage(copyButton, line); });
    meta.appendChild(copyButton);
    const body = document.createElement('div');
    /*
     * 按 markdown 渲染，而不是原样贴一大坨。
     *
     * 用户 2026-11-24：「不要用你规定的输出格式限定输出…我需要它和飞书、微信、
     * copilotchat 等对话框一样，能支持多种方式的输入输出，而不是规定死的模板」。
     */
    const bodyText = (line.phaseKey === 'result' || line.phaseKey === 'blocked')
      ? (line.full || line.body)
      : line.body;
    if (window.HwRichText) window.HwRichText.render(body, bodyText);
    else body.textContent = bodyText;
    bubble.appendChild(meta);
    bubble.appendChild(body);
    /*
     * 结构化信息（项目 / 用时 / 改动文件 / 被停止）：由界面画成小标签。
     * 以前这些是拼在正文里的「【项目 X】…用时 12s…改动文件：a、b」，
     * 看着就是程序在说话。
     */
    if (line.meta) {
      const chips = [];
      if (line.meta.stopped) chips.push('被停止');
      if (line.meta.project) chips.push(line.meta.project);
      if (typeof line.meta.seconds === 'number') chips.push('用时 ' + line.meta.seconds + 's');
      if (line.meta.files && line.meta.files.length) chips.push(line.meta.files.length + ' 个文件');
      if (chips.length) {
        const metaLine = document.createElement('div');
        metaLine.className = 'msg-meta';
        chips.forEach(function (text) {
          const chip = document.createElement('span');
          chip.textContent = text;
          metaLine.appendChild(chip);
        });
        if (line.meta.files && line.meta.files.length) metaLine.title = line.meta.files.join('\n');
        bubble.appendChild(metaLine);
      }
    }
    /* 追问的可点答案：点了直接发出（只发给问话的那台）。 */
    if (line.options && line.options.length) {
      const opts = document.createElement('div');
      opts.className = 'msg-options';
      line.options.forEach(function (option) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = option;
        button.addEventListener('click', function () {
          vscode.postMessage({
            type: 'send',
            text: option,
            assignee: line.device && line.device.id && !line.device.isLocal
              ? { id: line.device.id, name: line.device.name }
              : undefined
          });
        });
        opts.appendChild(button);
      });
      bubble.appendChild(opts);
    }
    /*
     * 附件：图片直接画出来，文件画成一行小卡片。
     *
     * 用户 2026-11-25：「团队群需要有普通对话框的文件附件读取图片输出等全部功能，
     * 不要砍功能」——群里发的图、agent 出的图，都该像普通对话框一样看得见。
     */
    if (line.assets && line.assets.length) {
      const box = document.createElement('div');
      box.className = 'msg-assets';
      line.assets.forEach(function (asset) {
        if (asset.kind === 'image' && asset.src) {
          const img = document.createElement('img');
          img.className = 'msg-image';
          img.src = asset.src;
          img.alt = asset.name;
          img.title = asset.name + '（点击用系统看图打开原图）';
          /*
           * 资源协议被拦 / 地址失效时，向宿主要字节改用 data URL 显示。
           *
           * 用户实况（2026-11-25）：「贴进团队群对话框的图片只显示占位图」——
           * 图片确实落盘了，但 asWebviewUri 生成的地址可能取不到；这条兜底让预览
           * 不依赖资源协议（只有失败的那张才会多传一次字节）。
           */
          img.addEventListener('error', function () {
            if (img.dataset.recovery === 'bytes') return;
            img.dataset.recovery = 'bytes';
            void requestAssetData(asset.id).then(function (data) {
              if (data && data.dataBase64) {
                img.src = 'data:' + (data.mimeType || 'image/png') + ';base64,' + data.dataBase64;
                return;
              }
              vscode.postMessage({ type: 'toast', text: '这张图取不到内容：' + asset.name });
            });
          });
          img.addEventListener('click', function () {
            vscode.postMessage({ type: 'openAsset', id: asset.id });
          });
          box.appendChild(img);
          return;
        }
        const chip = document.createElement('div');
        chip.className = 'msg-file';
        chip.textContent = (asset.kind === 'image' ? '图片 ' : '文件 ') + asset.name
          + (asset.ready ? '' : ' · 正在接收');
        chip.title = asset.name;
        box.appendChild(chip);
      });
      bubble.appendChild(box);
    }
    /*
     * 收到 / 没收到：写在气泡下面。
     *
     * 用户要求（2026-11-25）：「我发 @所有人的消息，window 这个 agent 收到后，
     * 这个消息下面会显示 Windows 这个 agent 已读」——否则分不清「没收到」
     * 和「收到了但正忙」。
     */
    const hasReceipt = (line.readBy && line.readBy.length) || (line.unreadBy && line.unreadBy.length);
    if (hasReceipt) {
      const receipt = document.createElement('div');
      receipt.className = line.readBy && line.readBy.length ? 'receipt' : 'receipt pending';
      if (line.readBy && line.readBy.length) {
        receipt.textContent = '已读：' + line.readBy.join('、');
        /*
         * 谁还没回执也要写出来。
         *
         * 用户实况（2026-11-25）：「默认所有人都收到消息，但是显示只有『已读：macOS …』，
         * 别的 agent 没有显示已读未读状态」——只列已读的话，没回执的那台等于「消失」，
         * 用户根本不知道它是没收到还是正在跑。
         */
        if (line.unreadBy && line.unreadBy.length) {
          const unread = document.createElement('span');
          unread.className = 'receipt-unread';
          unread.textContent = ' · 未读：' + line.unreadBy.join('、');
          receipt.appendChild(unread);
        }
      } else {
        // 一条回执都没有：直接点名在等谁，而不是一句无主语的「等待对方确认收到」。
        receipt.textContent = '等待确认收到：' + (line.unreadBy || []).join('、');
      }
      bubble.appendChild(receipt);
    }
    row.appendChild(bubble);
    feed.appendChild(row);
  }
  if (!state.lines.length && !state.pending) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<b>群里还没有发言</b><br>在下面发一条需求，频道里的乙方会各自给出解析；<br>有不清楚的地方它们会追问，你回答后才会开始动手。';
    feed.appendChild(empty);
  }
  /*
   * 刚发出去、还在判断「这是闲聊还是任务」的那句话。
   *
   * 判断要问一次模型，一两秒；这段时间必须先看到自己说的话，
   * 否则用户会以为没发出去、又发一遍。
   */
  if (state.pending) {
    const row = document.createElement('div');
    row.className = 'msg user pending';
    row.appendChild(avatar('你', 'user', { id: state.localId, name: '你', isLocal: true }));
    const bubble = document.createElement('div');
    bubble.className = 'bubble analysis';
    const meta = document.createElement('div');
    meta.className = 'meta';
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = '发送中';
    const who = document.createElement('span');
    who.textContent = '你';
    const time = document.createElement('span');
    time.textContent = state.pending.time || '';
    meta.appendChild(tag); meta.appendChild(who); meta.appendChild(time);
    const body = document.createElement('div');
    body.textContent = state.pending.body;
    bubble.appendChild(meta);
    bubble.appendChild(body);
    row.appendChild(bubble);
    feed.appendChild(row);
  }
  feed.scrollTop = feed.scrollHeight;
}

/**
 * 追问正文的预览：去掉 markdown 记号，压成一段干净的文字。
 *
 * 提醒条只负责「让你知道它在问什么」，不需要把整份报告铺出来 ——
 * 全文就在下方对话里，展开按钮可以临时看全。
 */
function bannerPreview(body) {
  /* 反引号不能直接写进模板字符串，用字符码拼。 */
  var tick = String.fromCharCode(96);
  return String(body || '')
    .replace(new RegExp(tick + '{3}[\\s\\S]*?' + tick + '{3}', 'g'), ' ')
    .replace(new RegExp(tick + '([^' + tick + ']+)' + tick, 'g'), '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/^\s*[-*]\s+/gm, '· ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 每台设备的 agent 状态灯。
 *
 * 文案用最短的词：运行中 / 等待确认 / 异常中断 / 已停止 —— 一行能把两台都看全，
 * 取代原来那句操作提示（提示本身没信息量，状态才有）。
 */
const STATUS_TEXT = {
  running: '运行中',
  waiting: '等待确认',
  error: '异常中断',
  idle: '已停止'
};
function renderAgentStatus(statuses) {
  const box = el('agentStatus');
  if (!box) return;
  box.textContent = '';
  statuses.forEach(function (item) {
    const row = document.createElement('span');
    row.className = 'who';
    const dot = document.createElement('span');
    dot.className = 'dot ' + (item.state || 'idle');
    dot.title = (STATUS_TEXT[item.state] || STATUS_TEXT.idle) + (item.isLocal ? '（本机）' : '');
    const name = document.createElement('span');
    name.textContent = item.label + (item.isLocal ? '（本机）' : '') + ' ' + (STATUS_TEXT[item.state] || STATUS_TEXT.idle);
    row.appendChild(dot);
    row.appendChild(name);
    box.appendChild(row);
  });
}

function renderAssign(state) {
  const box = el('assign');
  box.textContent = '';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = '由谁执行';
  box.appendChild(label);

  /*
   * 候选与 @ 选择同源：mentionTargets() 给每台算出**唯一 token**。
   *
   * 两台同名设备（都叫 DESKTOP）时 token 会补设备号短码，@ 谁就是谁，
   * 不会因为名字相同串台。
   */
  const chips = [{ id: null, name: '所有人', label: '所有人', token: '所有人' }]
    .concat(mentionTargets(state.peers));
  // 选中的设备掉线了就退回「所有人」，否则会发出一条谁都接不到的需求
  if (assignee && !chips.some(function (item) { return item.id === assignee.id; })) assignee = null;
  for (const item of chips) {
    const chip = document.createElement('button');
    chip.className = 'chip' + ((assignee ? assignee.id : null) === item.id ? ' on' : '');
    chip.textContent = item.id === null ? item.name : (item.label + (item.isLocal ? '（本机）' : ''));
    chip.title = item.id === null ? '不指定设备：每台都做' : ('@' + item.token + ' · ' + item.label);
    chip.addEventListener('click', () => {
      assignee = item.id === null ? null : { id: item.id, name: item.name, token: item.token };
      // 选中谁，输入框开头就写 @谁（没选就是 @所有人）。
      syncPrefixToAssignee(assignee);
      renderAssign(state);
    });
    box.appendChild(chip);
  }

  if (state.canStop) {
    const stop = document.createElement('button');
    stop.className = 'chip stop';
    stop.textContent = '停止执行';
    stop.addEventListener('click', () => vscode.postMessage({ type: 'control', command: 'stop' }));
    box.appendChild(stop);
  }
}

function send() {
  const raw = text.value;
  /*
   * **永远不能因为解析前缀而阻止发送。**
   *
   * 0.9.5 加过一条「只写了 @设备、没有正文就不发」的判断，结果两台的发送全被吃掉 ——
   * 用户打了字却发不出去，这是最不可接受的失败方式。
   * 现在：能剥就剥，剥完是空的就按原文发，绝不 return。
   */
  const stripped = raw.replace(/^@[^\s@]*\s*/, '');
  /*
   * 只写了 @设备 而没写正文：不发（这是明确的空输入）。
   * 但**只要还有别的字**，就按原文发 —— 绝不吃掉用户打的内容。
   */
  if (!stripped.trim() && /^@[^\s@]*\s*$/.test(raw)) return;
  const body = (stripped.trim() ? stripped : raw).trim();
  if (!body) return;
  /*
   * 指派对象：正文里的 @设备 优先，其次「由谁执行」的选择。
   * 前缀里的「@所有人」不算指派。
   */
  const fromText = mentionAssignee(raw);
  const target = fromText || assignee;
  const files = attached.map(function (item) { return item.id; }).filter(Boolean);
  text.value = '';
  autosize();
  closeMention();
  lastPrefix = '';
  assignee = null;
  if (lastState) renderAssign(lastState);
  /* 附件随这条消息一起给本机 agent（路径由扩展保存后返回）。 */
  vscode.postMessage({ type: 'send', text: body, assignee: target || undefined, attachments: files });
  attached.length = 0;
  paintAttachments();
}

/* ---------------- 附件与语音（和主对话框同一套能力） ---------------- */
/** 已附加到这条消息的文件；路径由扩展保存到磁盘后返回。 */
const attached = [];
function paintAttachments() {
  const box = el('attachList');
  if (!box) return;
  box.textContent = '';
  if (!attached.length) { box.style.display = 'none'; return; }
  box.style.display = 'flex';
  attached.forEach(function (item, index) {
    const chip = document.createElement('div');
    chip.className = 'attach-chip';
    const name = document.createElement('span');
    name.textContent = item.name;
    name.title = item.name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.addEventListener('click', function () { attached.splice(index, 1); paintAttachments(); });
    chip.appendChild(name);
    chip.appendChild(remove);
    box.appendChild(chip);
  });
}
function readAsBase64(file, done) {
  const reader = new FileReader();
  reader.onload = function () {
    const result = String(reader.result || '');
    done(result.slice(result.indexOf(',') + 1));
  };
  reader.onerror = function () { done(''); };
  reader.readAsDataURL(file);
}
function attachFiles(fileList) {
  Array.prototype.slice.call(fileList || []).forEach(function (file) {
    // 6 MB 上限和主对话框一致：再大就不是「顺手贴一张图」了。
    if (!file || file.size > 6 * 1024 * 1024) {
      vscode.postMessage({ type: 'toast', text: '附件超过 6 MB，没有添加' });
      return;
    }
    readAsBase64(file, function (dataBase64) {
      if (!dataBase64) return;
      vscode.postMessage({
        type: 'attach',
        name: file.name || 'attachment',
        mimeType: file.type || '',
        dataBase64: dataBase64
      });
    });
  });
}
if (el('attachBtn')) {
  el('attachBtn').addEventListener('click', function () { el('fileInput').click(); });
  el('fileInput').addEventListener('change', function (event) {
    attachFiles(event.target.files);
    event.target.value = '';
  });
  /* 直接粘贴图片：和主对话框一致 */
  text.addEventListener('paste', function (event) {
    const items = (event.clipboardData && event.clipboardData.items) || [];
    const files = [];
    for (let i = 0; i < items.length; i += 1) {
      if (items[i].kind === 'file') {
        const file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length) { event.preventDefault(); attachFiles(files); }
  });
  /* 拖文件进来也能加：主对话框支持拖放，团队群不能少这一步（否则「功能被砍」）。 */
  ['dragover', 'dragenter'].forEach(function (name) {
    text.addEventListener(name, function (event) { event.preventDefault(); });
  });
  text.addEventListener('drop', function (event) {
    const files = (event.dataTransfer && event.dataTransfer.files) || [];
    if (!files.length) return;
    event.preventDefault();
    attachFiles(files);
  });
  /* 语音输入：**不在 webview 里识别**（这里没有麦克风权限，start() 必然
   * not-allowed，用户 2026-11-25 就是这么撞上的）。交给宿主：装了 VS Code Speech
   * 就在 VS Code 内听写，没装就开一次性浏览器语音页，结果都通过 voiceText 回传。
   */
  let hwVoiceInserted = '';
  el('voiceBtn').addEventListener('click', function () {
    vscode.postMessage({ type: 'voice' });
  });
  /*
   * 麦克风按钮周围那圈「安装进度」。
   *
   * 用户 2026-11-25：装了 VS Code Speech 之后「录音图标周围显示一圈绿色的圆圈安装进度条，
   * 安装好可以正常使用了就闭环形成完整的圆圈，且绿色颜色亮 3 秒然后消失」。
   *
   * 用 SVG 环而不是 border：只有它能在**不改变按钮尺寸**的前提下画出精确的进度弧。
   */
  let voiceRing = null;
  let voiceRingTimer = null;
  function ensureVoiceRing() {
    if (voiceRing && voiceRing.isConnected) return voiceRing;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'voice-ring');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    track.setAttribute('class', 'track');
    track.setAttribute('cx', '50'); track.setAttribute('cy', '50'); track.setAttribute('r', '46');
    const bar = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bar.setAttribute('class', 'bar');
    bar.setAttribute('cx', '50'); bar.setAttribute('cy', '50'); bar.setAttribute('r', '46');
    bar.setAttribute('pathLength', '100');
    svg.appendChild(track);
    svg.appendChild(bar);
    el('voiceBtn').classList.add('has-ring');
    el('voiceBtn').appendChild(svg);
    voiceRing = svg;
    return svg;
  }
  function paintVoiceRing(phase) {
    if (!el('voiceBtn')) return;
    if (voiceRingTimer) { clearTimeout(voiceRingTimer); voiceRingTimer = null; }
    if (phase === 'failed') {
      if (voiceRing && voiceRing.isConnected) voiceRing.remove();
      el('voiceBtn').classList.remove('has-ring');
      voiceRing = null;
      return;
    }
    const svg = ensureVoiceRing();
    svg.classList.remove('installing', 'ready');
    if (phase === 'installing') {
      // 进度不可知（VS Code 不提供下载百分比），先跑到 88% 等完成信号。
      svg.classList.add('installing');
      return;
    }
    // ready：闭环 + 亮 3 秒，一次性特效。
    svg.classList.add('ready');
    voiceRingTimer = setTimeout(function () {
      if (voiceRing && voiceRing.isConnected) voiceRing.remove();
      el('voiceBtn').classList.remove('has-ring');
      voiceRing = null;
    }, 3_000);
  }
  /* 录音时用一排音波条替换话筒图标（懒创建，只建一次）。 */
  function ensureVoiceBars() {
    const button = el('voiceBtn');
    if (!button || button.querySelector('.voice-bars')) return;
    const bars = document.createElement('span');
    bars.className = 'voice-bars';
    bars.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 5; index += 1) bars.appendChild(document.createElement('i'));
    button.appendChild(bars);
  }
  window.hwAppendVoiceText = function (value, live) {
    /*
     * 识别结果是**整段重发**的（听写每变一次就把整句送过来），
     * 所以先撤掉上一次插进来的那段再插入新的 —— 否则一句话会重复十几遍。
     */
    const clean = String(value || '').trim();
    if (!clean) return;
    let base = text.value;
    if (hwVoiceInserted) {
      if (base.endsWith(hwVoiceInserted)) base = base.slice(0, base.length - hwVoiceInserted.length);
      else base = base.split(hwVoiceInserted).join('');
    }
    const trimmed = base.replace(/\s+$/, '');
    text.value = trimmed ? trimmed + ' ' + clean : clean;
    // 记住这一段：下一次识别结果是整段重发，要把它替换掉（而不是追加）。
    hwVoiceInserted = clean;
    autosize();
    text.focus();
  };
}

function autosize() {
  text.style.height = 'auto';
  text.style.height = Math.min(text.scrollHeight, Math.round(window.innerHeight * 0.4)) + 'px';
}

el('send').addEventListener('click', send);
text.addEventListener('input', () => {
  autosize();
  syncMention();
  /*
   * 用户手动删掉了开头的 @：选择跟着回到「所有人」。
   *
   * 这是用户定的规则：「不选继续输入或者删掉 @，选择会消失，就默认是所有设备」。
   */
  const hasPrefix = /^@[^\s@]*\s/.test(text.value);
  if (lastPrefix && !hasPrefix) {
    lastPrefix = '';
    assignee = null;
    if (lastState) renderAssign(lastState);
  } else if (hasPrefix) {
    lastPrefix = (text.value.match(/^@[^\s@]*\s/) ?? [''])[0];
  }
});
/* 光标移动（点别处、按方向键）也要同步，否则删掉 @ 后列表还挂着。 */
text.addEventListener('click', syncMention);
text.addEventListener('keyup', (event) => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') syncMention();
});
text.addEventListener('blur', () => { setTimeout(closeMention, 120); });
text.addEventListener('keydown', (event) => {
  if (mentionItems.length) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      mentionIndex = (mentionIndex + 1) % mentionItems.length;
      paintMention();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      mentionIndex = (mentionIndex - 1 + mentionItems.length) % mentionItems.length;
      paintMention();
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      chooseMention(mentionItems[mentionIndex]);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMention();
      return;
    }
  }
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); }
});
for (const button of document.querySelectorAll('.toolbar button')) {
  button.addEventListener('click', () => vscode.postMessage({ type: 'command', command: button.dataset.command }));
}
el('copyInvite').addEventListener('click', () => {
  const button = el('copyInvite');
  // 立刻给出可见结果：以前点了完全没反应，用户不知道复制成没成。
  button.classList.add('copied');
  button.textContent = '已复制';
  vscode.postMessage({ type: 'copyInvite', text: el('invite').dataset.text || el('inviteCode').textContent || '' });
  setTimeout(() => {
    button.classList.remove('copied');
    button.textContent = '复制邀请码';
  }, 1400);
});
el('copyInviteInline').addEventListener('click', (event) => {
  // 收起状态下也能直接复制，不必先展开。
  event.stopPropagation();
  const button = event.currentTarget;
  button.textContent = '已复制';
  vscode.postMessage({ type: 'copyInvite', text: el('invite').dataset.text || el('inviteCode').textContent || '' });
  setTimeout(() => { button.textContent = '复制'; }, 1400);
});
el('inviteToggle').addEventListener('click', (event) => {
  if (event.target === el('copyInviteInline')) return;
  inviteCollapsed = !inviteCollapsed;
  paintInvite();
});
el('moreBtn').addEventListener('click', () => {
  drawerOpen = !drawerOpen;
  paintDrawer();
});
window.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'state') render(data);
  /* 附件保存结果：拿到磁盘路径后挂到这条消息上。 */
  if (data.type === 'attached' && data.item) {
    attached.push(data.item);
    paintAttachments();
  }
  if (data.type === 'attachFailed') {
    vscode.postMessage({ type: 'toast', text: '附件添加失败：' + (data.reason || '未知原因') });
  }
  /* 复制要用的附件原图字节（宿主按资产 id 读回来）。 */
  if (data.type === 'assetData') finishAssetData(data);
  /* 语音识别结果（宿主用 VS Code 内听写 / 浏览器语音页拿到）：替换式填进输入框。 */
  if (data.type === 'voiceText' && typeof data.text === 'string' && window.hwAppendVoiceText) {
    window.hwAppendVoiceText(data.text, data.live !== false);
  }
  /* 把焦点放回输入框（系统听写 Win+H / Fn 需要有焦点才会打进这里）。 */
  if (data.type === 'focusComposer') { text.focus(); }
  /* 录音中：话筒图标换成一排跳动的音波条（和主对话框一致）。 */
  if (data.type === 'voiceState') {
    if (data.active) ensureVoiceBars();
    if (el('voiceBtn')) el('voiceBtn').classList.toggle('voice-recording', Boolean(data.active));
    if (!data.active) hwVoiceInserted = '';
  }
  /* 装 VS Code Speech 的进度：麦克风按钮周围那圈绿环。 */
  if (data.type === 'voiceSetup') paintVoiceRing(data.phase);
});
vscode.postMessage({ type: 'ready' });
