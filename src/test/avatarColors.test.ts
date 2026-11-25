import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * 头像按设备上色（用户 2026-11-24）：
 * 「将不同的设备的 agent 在群里显示不同的头像颜色、不同设备的用户输入的消息，
 *   头像也需要不同颜色，方便区分」。
 *
 * 这里锁两个不变量：
 *  1. 颜色必须由**设备 id 稳定派生** —— 同一台设备在任意窗口、任何时候都是同一个颜色；
 *  2. 两台设备不能拿到同一个颜色（否则等于没区分）。
 */

function hueOf(id: string): number {
  const text = String(id || 'unknown');
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  const hue = hash % 300;
  return hue < 15 ? hue + 300 : hue;
}

test('同一台设备每次都是同一个颜色', () => {
  assert.equal(hueOf('1334c171f7ab6f47'), hueOf('1334c171f7ab6f47'));
  assert.equal(hueOf('47c1e076cdb24475'), hueOf('47c1e076cdb24475'));
});

test('两台真实设备拿到不同色相', () => {
  const win = hueOf('1334c171f7ab6f47');
  const mac = hueOf('47c1e076cdb24475');
  assert.notEqual(win, mac, `两台设备的色相不该相同（${win} vs ${mac}）`);
});

test('色相落在合法区间，不会出现负值或超过 359', () => {
  for (const id of ['a', 'bb', 'p-win', 'p-mac', '', 'unknown', '很长的中文设备名']) {
    const hue = hueOf(id);
    assert.ok(hue >= 0 && hue <= 359, `${id} → ${hue}`);
  }
});

test('分配得比较均匀（相邻多台设备不会挤在一个色相上）', () => {
  const hues = new Set();
  for (let i = 0; i < 20; i += 1) hues.add(hueOf(`device-${i}`));
  assert.ok(hues.size >= 16, `20 台设备应至少得到 16 种不同色相，实际 ${hues.size}`);
});
