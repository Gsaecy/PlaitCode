/*
 * 群窗口的富文本渲染（markdown）。
 *
 * 用户 2026-11-24：「不要用你规定的输出格式限定输出，vscode 支持的输出方式，
 * 难道就是这种画着框框的文本条款？我需要它和飞书、微信、copilotchat 等对话框一样，
 * 能支持多种方式的输入输出，而不是规定死的模板」。
 *
 * 所以群里的发言不再当纯文本贴上去，而是按 markdown 渲染出结构：
 * 标题 / 有序无序列表 / 表格 / 引用 / 分隔线 / 围栏代码块（带语言与复制）/
 * 行内加粗、斜体、删除线、行内代码、链接、图片。
 *
 * 安全：全程用 DOM + textContent 构造，**不拼 HTML 字符串** —— agent 输出里的
 * `<script>` 永远是文字。链接与图片只接受白名单协议，其余按纯文本显示。
 */
(function (global) {
  'use strict';

  var FENCE = /^\s*```\s*([A-Za-z0-9+#._-]*)\s*$/;
  var HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
  var UL = /^(\s*)[-*+]\s+(.*)$/;
  var OL = /^(\s*)\d+[.)]\s+(.*)$/;
  var HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
  var QUOTE = /^\s{0,3}>\s?(.*)$/;
  var TABLE_ROW = /^\s*\|(.+)\|\s*$/;
  var TABLE_SEP = /^\s*\|?[\s:|-]+\|?\s*$/;

  function safeUrl(raw) {    var url = String(raw || '').trim();
    if (!url) return '';
    if (/^(https?:|mailto:)/i.test(url)) return url;
    if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(url)) return url;
    return '';
  }

  function el(tag, cls) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  }

  /* ---------------- 行内 ---------------- */

  var INLINE = [
    { re: /`([^`]+)`/g, kind: 'code' },
    { re: /\*\*([^*]+)\*\*/g, kind: 'strong' },
    { re: /__([^_]+)__/g, kind: 'strong' },
    { re: /~~([^~]+)~~/g, kind: 'strike' },
    { re: /\*([^*\n]+)\*/g, kind: 'em' },
    { re: /!\[([^\]]*)\]\(([^)\s]+)\)/g, kind: 'image' },
    { re: /\[([^\]]+)\]\(([^)\s]+)\)/g, kind: 'link' }
  ];

  function inline(parent, text) {
    var source = String(text == null ? '' : text);
    if (!source) return;
    var index = 0;
    while (index < source.length) {
      var best = null;
      for (var i = 0; i < INLINE.length; i += 1) {
        var rule = INLINE[i];
        rule.re.lastIndex = index;
        var match = rule.re.exec(source);
        if (match && match.index === index && (!best || match[0].length > best.match[0].length)) {
          best = { rule: rule, match: match };
        }
      }
      if (!best) {
        // 找下一个可能开始的标记，中间那段一次写完
        var next = source.length;
        for (var j = 0; j < INLINE.length; j += 1) {
          INLINE[j].re.lastIndex = index;
          var probe = INLINE[j].re.exec(source);
          if (probe && probe.index < next) next = probe.index;
        }
        if (next <= index) next = index + 1;
        parent.appendChild(document.createTextNode(source.slice(index, next)));
        index = next;
        continue;
      }
      var m = best.match;
      var kind = best.rule.kind;
      if (kind === 'code') {
        var code = el('code');
        code.textContent = m[1];
        parent.appendChild(code);
      } else if (kind === 'strong' || kind === 'em' || kind === 'strike') {
        var tag = kind === 'strong' ? 'strong' : (kind === 'em' ? 'em' : 'del');
        var node = el(tag);
        inline(node, m[1]);
        parent.appendChild(node);
      } else if (kind === 'link') {
        var href = safeUrl(m[2]);
        if (!href) {
          parent.appendChild(document.createTextNode(m[0]));
        } else {
          var a = el('a');
          a.href = '#';
          a.dataset.href = href;
          a.textContent = m[1];
          parent.appendChild(a);
        }
      } else if (kind === 'image') {
        var src = safeUrl(m[2]);
        if (!src) {
          parent.appendChild(document.createTextNode(m[0]));
        } else {
          var img = el('img', 'md-img');
          img.alt = m[1] || '';
          img.src = src;
          img.loading = 'lazy';
          parent.appendChild(img);
        }
      }
      index = m.index + m[0].length;
    }
  }

  /* ---------------- 块 ---------------- */

  function codeBlock(lang, code) {
    var box = el('div', 'md-code');
    var head = el('div', 'md-code-head');
    var label = el('span', 'md-code-lang');
    label.textContent = lang || 'text';
    var copy = el('button', 'md-copy');
    copy.type = 'button';
    copy.textContent = '复制';
    copy.addEventListener('click', function () {
  if (global.HwPost) global.HwPost({ type: 'copyText', text: code });
      else if (global.postMessage) global.postMessage({ type: 'copyText', text: code }, '*');
      copy.textContent = '已复制';
      setTimeout(function () { copy.textContent = '复制'; }, 1500);
    });
    head.appendChild(label);
    head.appendChild(copy);
    var pre = el('pre');
    var node = el('code');
    node.textContent = code;
    pre.appendChild(node);
    box.appendChild(head);
    box.appendChild(pre);
    return box;
  }

  function table(rows) {
    var wrap = el('div', 'md-table-wrap');
    var node = el('table', 'md-table');
    rows.forEach(function (cells, rowIndex) {
      var tr = el('tr');
      cells.forEach(function (cell) {
        var td = el(rowIndex === 0 ? 'th' : 'td');
        inline(td, cell);
        tr.appendChild(td);
      });
      node.appendChild(tr);
    });
    wrap.appendChild(node);
    return wrap;
  }

  function splitRow(line) {
    var inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    return inner.split('|').map(function (cell) { return cell.trim(); });
  }

  function list(lines, start) {
    var ordered = OL.test(lines[start]);
    var root = el(ordered ? 'ol' : 'ul', 'md-list');
    var index = start;
    var current = root;
    var depth = 0;
    while (index < lines.length) {
      var line = lines[index];
      var ul = UL.exec(line);
      var ol = OL.exec(line);
      var hit = ordered ? ol : ul;
      if (!hit) {
        // 空行后如果还是列表项就继续，否则结束
        if (!line.trim() && index + 1 < lines.length && (UL.test(lines[index + 1]) || OL.test(lines[index + 1]))) {
          index += 1;
          continue;
        }
        break;
      }
      var indent = hit[1].replace(/\t/g, '    ').length;
      var level = Math.floor(indent / 2);
      while (level > depth) {
        var nested = el(ordered ? 'ol' : 'ul', 'md-list');
        var last = current.lastElementChild;
        if (!last) break;
        last.appendChild(nested);
        current = nested;
        depth += 1;
      }
      while (level < depth) {
        current = current.parentElement || current;
        depth -= 1;
      }
      var li = el('li');
      inline(li, hit[2]);
      current.appendChild(li);
      index += 1;
    }
    return { node: root, next: index };
  }

  function render(container, text) {
    container.textContent = '';
    container.classList.add('md');
    var lines = String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n');
    var index = 0;
    var paragraph = [];

    function flush() {
      if (!paragraph.length) return;
      var value = paragraph.join('\n').trim();
      paragraph = [];
      if (!value) return;
      var p = el('p');
      inline(p, value);
      container.appendChild(p);
    }

    while (index < lines.length) {
      var line = lines[index] || '';

      var fence = FENCE.exec(line);
      if (fence) {
        flush();
        var lang = fence[1];
        index += 1;
        var body = [];
        while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
          body.push(lines[index]);
          index += 1;
        }
        index += 1;
        container.appendChild(codeBlock(lang, body.join('\n')));
        continue;
      }

      var heading = HEADING.exec(line);
      if (heading) {
        flush();
        var h = el('h' + Math.min(6, heading[1].length));
        inline(h, heading[2]);
        container.appendChild(h);
        index += 1;
        continue;
      }

      if (HR.test(line)) {
        flush();
        container.appendChild(el('hr'));
        index += 1;
        continue;
      }

      if (QUOTE.test(line)) {
        flush();
        var quote = el('blockquote');
        var collected = [];
        while (index < lines.length && QUOTE.test(lines[index])) {
          collected.push(QUOTE.exec(lines[index])[1]);
          index += 1;
        }
        inline(quote, collected.join('\n'));
        container.appendChild(quote);
        continue;
      }

      if (TABLE_ROW.test(line) && index + 1 < lines.length && TABLE_SEP.test(lines[index + 1])) {
        flush();
        var rows = [splitRow(line)];
        index += 2;
        while (index < lines.length && TABLE_ROW.test(lines[index])) {
          rows.push(splitRow(lines[index]));
          index += 1;
        }
        container.appendChild(table(rows));
        continue;
      }

      if (UL.test(line) || OL.test(line)) {
        flush();
        var built = list(lines, index);
        container.appendChild(built.node);
        index = built.next;
        continue;
      }

      if (!line.trim()) {
        flush();
        index += 1;
        continue;
      }

      paragraph.push(line);
      index += 1;
    }
    flush();
  }

  /* 链接点击：交给宿主用系统浏览器打开（webview 里直接跳转会把面板顶掉）。 */
  document.addEventListener('click', function (event) {
    var target = event.target;
    while (target && target.tagName !== 'A') target = target.parentElement;
    if (!target || !target.dataset || !target.dataset.href) return;
    event.preventDefault();
    if (global.HwPost) global.HwPost({ type: 'openLink', url: target.dataset.href });
    else if (global.postMessage) global.postMessage({ type: 'openLink', url: target.dataset.href }, '*');
  });

  global.HwRichText = { render: render };
})(typeof window !== 'undefined' ? window : this);
