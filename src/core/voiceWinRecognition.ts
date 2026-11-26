/**
 * Windows 原生语音识别：不装任何扩展、不弹系统听写界面，麦克风与识别都在本机。
 *
 * 用户 2026-11-25：「`Win+H` 能把字打进 HWChat 输入框，但是需要按快捷键，想让它看起来
 * 像是扩展自己的功能，而不是唤起系统的录音」。
 *
 * 做法：用 Windows 自带的 .NET 语音引擎（`System.Speech`）在**扩展自己拉起的子进程**里
 * 录音并识别 —— 麦克风由系统驱动采集，但没有系统听写那个浮层；识别出的文字实时回流到
 * 我们的输入框，看起来就是「点了麦克风就能说话」。
 *
 * 为什么可以这么做：`System.Speech.Recognition.SpeechRecognitionEngine` 是 .NET Framework
 * 自带的离线听写引擎，Windows 只要装了对应语言的「语音识别」组件就可用（中文系统通常是
 * zh-CN）。它属于扩展进程，不需要 VS Code Speech，也不需要任何 API key。
 *
 * 输出协议（一行一条，UTF-8）：
 *   `READY <culture>`  引擎就绪，开始录音
 *   `H <text>`         临时结果（还没定稿，界面应替换上一条临时结果）
 *   `R <text>`         定稿结果（应追加）
 *   `E <reason>`       失败原因（没有识别器 / 没有麦克风等）
 *   `DONE`             正常收尾
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 探测脚本：只列出这台机器上装了哪些听写识别器，几秒内退出。 */
export function recognizerProbeScript(): string {
  return [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'try {',
    '  Add-Type -AssemblyName System.Speech',
    '  $list = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()',
    '  if (-not $list -or $list.Count -eq 0) { Write-Output "NONE"; exit 0 }',
    '  foreach ($item in $list) { Write-Output ("OK " + $item.Culture.Name) }',
    '} catch { Write-Output ("ERR " + $_.Exception.Message) }',
  ].join('\r\n');
}

/**
 * 录音 + 识别脚本。
 *
 * `-Action` 里的事件处理跑在另一个 runspace，`Write-Output` 不会进父进程的 stdout，
 * 所以统一用 `[Console]::Out.WriteLine` 直接写控制台；`Flush` 必须调，否则 Node 端
 * 要等到缓冲区满才看得到字（实时性就没了）。
 */
export function recognizerStreamScript(): string {
  return [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$ErrorActionPreference = "Stop"',
    'try { Add-Type -AssemblyName System.Speech } catch { [Console]::Out.WriteLine("E add-type"); exit 2 }',
    'try {',
    '  $recognizers = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()',
    '} catch { [Console]::Out.WriteLine("E enumerate"); exit 2 }',
    'if (-not $recognizers -or $recognizers.Count -eq 0) { [Console]::Out.WriteLine("E no-recognizer"); exit 3 }',
    '$wanted = $env:HWCHAT_SPEECH_CULTURE',
    '$target = $null',
    'if ($wanted) { $target = $recognizers | Where-Object { $_.Culture.Name -eq $wanted } | Select-Object -First 1 }',
    'if (-not $target) { $target = $recognizers | Select-Object -First 1 }',
    'try {',
    '  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine $target',
    '  $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))',
    '  $engine.SetInputToDefaultAudioDevice()',
    '  $engine.InitialSilenceTimeout = [TimeSpan]::FromSeconds(30)',
    '  $engine.BabbleTimeout = [TimeSpan]::FromSeconds(30)',
    '  $engine.EndSilenceTimeout = [TimeSpan]::FromSeconds(1)',
    '} catch {',
    '  [Console]::Out.WriteLine(("E init " + $_.Exception.Message))',
    '  exit 4',
    '}',
    'Register-ObjectEvent -InputObject $engine -EventName SpeechHypothesized -Action {',
    '  [Console]::Out.WriteLine("H " + $EventArgs.Result.Text); [Console]::Out.Flush()',
    '} | Out-Null',
    'Register-ObjectEvent -InputObject $engine -EventName SpeechRecognized -Action {',
    '  [Console]::Out.WriteLine("R " + $EventArgs.Result.Text); [Console]::Out.Flush()',
    '} | Out-Null',
    'try { $engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple) } catch {',
    '  [Console]::Out.WriteLine(("E start " + $_.Exception.Message))',
    '  exit 5',
    '}',
    '[Console]::Out.WriteLine("READY " + $target.Culture.Name); [Console]::Out.Flush()',
    '$ttl = 600',
    'if ($env:HWCHAT_SPEECH_TTL) { $ttl = [int]$env:HWCHAT_SPEECH_TTL }',
    '$until = (Get-Date).AddSeconds($ttl)',
    'while ((Get-Date) -lt $until) { Start-Sleep -Milliseconds 120 }',
    'try { $engine.RecognizeAsyncStop() } catch { }',
    'try { $engine.Dispose() } catch { }',
    '[Console]::Out.WriteLine("DONE")',
  ].join('\r\n');
}

export interface RecognizerAvailability {
  ok: boolean;
  /** 第一个可用识别器的语言（如 `zh-CN`）。 */
  culture?: string;
  reason?: string;
}

/** 这台机器上有没有可用的离线听写识别器（结果缓存到进程退出）。 */
let cachedAvailability: RecognizerAvailability | undefined;
export async function windowsRecognizerAvailable(force = false): Promise<RecognizerAvailability> {
  if (process.platform !== 'win32') return { ok: false, reason: 'not-windows' };
  if (!force && cachedAvailability) return cachedAvailability;
  const output = await runScript(recognizerProbeScript(), 15_000).catch(() => '');
  const line = output.split(/\r?\n/).find((item) => item.startsWith('OK '));
  const none = /^NONE/m.test(output);
  const result: RecognizerAvailability = line
    ? { ok: true, culture: line.slice(3).trim() }
    : { ok: false, reason: none ? 'no-recognizer' : 'probe-failed' };
  cachedAvailability = result;
  return result;
}

/** 跑一段一次性脚本并收全部输出（探测用）。 */
function runScript(script: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), 'hwchat-voice-'));
    const file = join(dir, 'probe.ps1');
    try {
      writeFileSync(file, script, 'utf8');
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      reject(error);
      return;
    }
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], {
      windowsHide: true,
    });
    let output = '';
    const timer = setTimeout(() => { try { child.kill(); } catch { /* 已退出 */ } }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { output += chunk; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { output += chunk; });
    child.on('error', (error) => { clearTimeout(timer); rmSync(dir, { recursive: true, force: true }); reject(error); });
    child.on('close', () => {
      clearTimeout(timer);
      rmSync(dir, { recursive: true, force: true });
      resolve(output);
    });
  });
}

/** 解析子进程输出的一行。 */
export function parseRecognizerLine(line: string): { kind: 'ready' | 'interim' | 'final' | 'error' | 'done' | 'ignore'; text: string } {
  const value = line.trim();
  if (!value) return { kind: 'ignore', text: '' };
  if (value === 'DONE') return { kind: 'done', text: '' };
  const space = value.indexOf(' ');
  const tag = space < 0 ? value : value.slice(0, space);
  const rest = space < 0 ? '' : value.slice(space + 1).trim();
  if (tag === 'READY') return { kind: 'ready', text: rest };
  if (tag === 'H') return rest ? { kind: 'interim', text: rest } : { kind: 'ignore', text: '' };
  if (tag === 'R') return rest ? { kind: 'final', text: rest } : { kind: 'ignore', text: '' };
  if (tag === 'E') return { kind: 'error', text: rest || 'unknown' };
  return { kind: 'ignore', text: '' };
}

export interface NativeDictation {
  /** 识别器语言（`zh-CN` 之类）。 */
  culture: string;
  stop(): void;
}

/**
 * 开始原生录音识别。
 *
 * 定稿与临时结果都通过回调给出；调用方负责把它们拼成输入框里的文字
 * （临时结果替换、定稿追加）。
 */
export async function startNativeDictation(options: {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError?: (reason: string) => void;
  /**
   * 识别进程自己退出了（到了最长录音时间 TTL / 识别器内部停止）。
   *
   * 为什么需要：录音状态（界面上的音波条）是由**会话**控制的。进程悄悄退出
   * 而没人通知，按钮就会一直显示「正在录音」，用户还以为麦克风开着。
   */
  onExit?: () => void;
  log?: (line: string) => void;
  /** 单次会话最长录音时间，防止忘记关。 */
  ttlSeconds?: number;
}): Promise<NativeDictation> {
  const dir = mkdtempSync(join(tmpdir(), 'hwchat-voice-'));
  const file = join(dir, 'recognize.ps1');
  writeFileSync(file, recognizerStreamScript(), 'utf8');
  const child: ChildProcessWithoutNullStreams = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file],
    {
      windowsHide: true,
      env: { ...process.env, HWCHAT_SPEECH_TTL: String(options.ttlSeconds ?? 600) },
    },
  );
  let culture = '';
  let stopped = false;
  let buffer = '';
  const cleanup = (): void => {
    try { child.kill(); } catch { /* 已退出 */ }
    // 子进程里还有事件订阅，纯 kill 有时留半秒；taskkill 更干净。
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => undefined);
    } catch { /* 忽略 */ }
    rmSync(dir, { recursive: true, force: true });
  };

  const ready = new Promise<string>((resolve, reject) => {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        const parsed = parseRecognizerLine(line);
        if (parsed.kind === 'ready') {
          culture = parsed.text;
          resolve(culture);
        } else if (parsed.kind === 'interim') {
          options.onInterim(parsed.text);
        } else if (parsed.kind === 'final') {
          options.onFinal(parsed.text);
        } else if (parsed.kind === 'error') {
          options.log?.(`[voice] 原生识别失败：${parsed.text}`);
          options.onError?.(parsed.text);
          reject(new Error(parsed.text));
        } else if (parsed.kind === 'done') {
          options.log?.('[voice] 原生识别结束');
        }
        index = buffer.indexOf('\n');
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => options.log?.(`[voice] ${chunk.trim()}`));
    child.on('error', (error) => reject(error));
    child.on('close', () => {
      if (!culture) reject(new Error('closed'));
      if (!stopped) {
        options.log?.('[voice] 录音进程已退出');
        // 自退出（TTL 到点等）：告诉调用方收掉录音状态，别让按钮一直亮着。
        options.onExit?.();
      }
    });
  });

  const started = await ready.catch((error: unknown) => {
    cleanup();
    throw error instanceof Error ? error : new Error(String(error));
  });

  return {
    culture: started,
    stop(): void {
      if (stopped) return;
      stopped = true;
      cleanup();
    },
  };
}
