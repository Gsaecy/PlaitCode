/**
 * 飞书机器人通知。
 *
 * 为什么不让每台开发机各自配 webhook：那是把「一个群机器人地址」复制到所有人机器上，
 * 换群就要挨个改，还会泄进日志。放在中继上统一配置，客户端只说「发生了什么事」。
 *
 * 隐私边界：只发**元数据**（谁、什么类型、一句话摘要），不发代码、不发命令输出。
 */

export type NotifyKind = 'approval' | 'done' | 'blocked';

export interface NotifyPayload {
  kind: NotifyKind;
  title: string;
  summary: string;
  /** 设备/项目，帮助接收者判断是哪台机器。 */
  source?: string;
}

const KIND_LABEL: Record<NotifyKind, string> = {
  approval: '需要你批准',
  done: '任务完成',
  blocked: '未执行',
};

const KIND_ICON: Record<NotifyKind, string> = {
  approval: '⏳',
  done: '✅',
  blocked: '⚠️',
};

/** 飞书自定义机器人的文本消息体。文本比卡片稳：卡片 schema 变过一次。 */
export function buildFeishuText(payload: NotifyPayload, link: string): string {
  const head = `${KIND_ICON[payload.kind]} HWChat · ${KIND_LABEL[payload.kind]}`;
  const lines = [
    head,
    payload.title ? `事项：${payload.title}` : '',
    payload.summary ? `详情：${payload.summary}` : '',
    payload.source ? `来自：${payload.source}` : '',
    link ? `打开：${link}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

export async function sendFeishuNotify(
  hook: string,
  payload: NotifyPayload,
  link: string,
  timeoutMs = 5_000,
): Promise<{ ok: boolean; error?: string }> {
  if (!/^https:\/\//i.test(hook)) return { ok: false, error: 'webhook 必须是 https 地址' };
  try {
    const response = await fetch(hook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text: buildFeishuText(payload, link) } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    // 飞书即使业务失败也返回 200，要看 body 里的 code
    const body = await response.json().catch(() => undefined) as { code?: number; StatusCode?: number; msg?: string } | undefined;
    const code = body?.code ?? body?.StatusCode ?? 0;
    if (code !== 0) return { ok: false, error: body?.msg ?? `code ${code}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
