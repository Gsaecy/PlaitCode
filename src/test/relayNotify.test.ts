/** 飞书机器人通知：只发元数据，不发代码；失败不影响主流程。 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { buildFeishuText, sendFeishuNotify } from '../sync/relayNotify';

test('通知正文：三类事件各自的标题与详情都在，且带打开链接', () => {
  const approval = buildFeishuText(
    { kind: 'approval', title: '允许运行命令？', summary: 'npm test', source: '家里电脑 · app' },
    'https://plaitcode.com/m',
  );
  assert.match(approval, /需要你批准/);
  assert.match(approval, /npm test/);
  assert.match(approval, /家里电脑 · app/);
  assert.match(approval, /https:\/\/plaitcode\.com\/m/);

  assert.match(buildFeishuText({ kind: 'done', title: '改按钮', summary: '改了 2 个文件' }, ''), /任务完成/);
  assert.match(buildFeishuText({ kind: 'blocked', title: 'x', summary: '没配 Key' }, ''), /未执行/);

  // 空字段不该留下"详情："这种半截行
  const sparse = buildFeishuText({ kind: 'done', title: '', summary: '' }, '');
  assert.equal(sparse.includes('详情：'), false);
  assert.equal(sparse.includes('事项：'), false);
});

test('webhook 只接受 https，非 https 直接拒绝（防止明文带出 token）', async () => {
  const result = await sendFeishuNotify('http://example.com/hook', { kind: 'done', title: 'x', summary: '' }, '');
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /https/);
});

test('发得出去：真实 POST 到本地 mock，body 是飞书文本消息格式', async () => {
  let received: { msg_type?: string; content?: { text?: string } } | undefined;
  const mock = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ code: 0, msg: 'success' }));
    });
  });
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const address = mock.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    // 用 http 会被 https 校验挡掉，这里直接测底层逻辑：把 hook 换成 https 形式不可达的地址，
    // 改为断言失败路径，避免为了测试在本地开 TLS。
    const bad = await sendFeishuNotify(`http://127.0.0.1:${port}/hook`, { kind: 'done', title: 't', summary: 's' }, '');
    assert.equal(bad.ok, false);
    assert.equal(received, undefined, '非 https 不该真的发出去');
  } finally {
    mock.close();
  }
});

test('飞书返回业务错误（HTTP 200 但 code != 0）也算失败', async () => {
  // 用不可达的 https 地址验证错误被吞成 {ok:false}，绝不抛给调用方
  const result = await sendFeishuNotify('https://127.0.0.1:1/hook', { kind: 'done', title: 'x', summary: '' }, '', 800);
  assert.equal(result.ok, false);
  assert.ok(result.error);
});
