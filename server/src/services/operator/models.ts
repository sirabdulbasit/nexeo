/**
 * DEF-386 — the two operator models, behind one interface, and the independent
 * check that decides whether a run really reached its goal.
 *
 *   ClaudeOperator  Anthropic API, `computer_toolset_20260801` (the only computer-use
 *                   form Claude Opus 5.5 accepts). Members Suzi has no hands for are
 *                   switched off in `configs`, so the model is never offered them.
 *   UiTarsOperator  a self-hosted UI-TARS 1.5 behind an OpenAI-compatible endpoint
 *                   (vLLM). One action per screenshot, so it observes after every act.
 *
 * Both end a run ONLY through `finish` (Claude: a tool; UI-TARS: finished()/call_user()).
 * Neither can mark a run done by itself: the engine checks the screen first.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ModelCall, OpAction } from './actions';

export interface Usage { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export interface CallResult { id: string; ok: boolean; text?: string; image?: string }
export type FinishOutcome = 'done' | 'needs_user' | 'cannot_do';
export interface Finish { id: string; outcome: FinishOutcome; summary: string; question?: string; reason?: string }
export interface ModelTurn { calls: ModelCall[]; finish?: Finish; note?: string; usage: Usage; refused?: string }

export interface OperatorModel {
  readonly label: string;
  /** Results of every call from the previous turn (and the opening screenshot on the first). */
  next(results: CallResult[], signal?: AbortSignal): Promise<ModelTurn>;
}

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
const ANTHROPIC_BETAS = 'thinking-display-updates-2026-08-18,server-side-fallback-2026-07-01';
const TOOLSET = 'computer';
export const NOT_EXECUTED = 'Not executed: an earlier computer action in this turn failed.';

/** Toolset members with no Suzi hand behind them: off, so they are never offered. */
const DISABLED_MEMBERS = ['zoom', 'right_click', 'middle_click', 'double_click', 'triple_click', 'left_click_drag', 'mouse_move', 'left_mouse_down', 'left_mouse_up', 'hold_key'];

export function operatorSystemPrompt(os: string): string {
  return [
    `You operate the user's ${os || 'macOS'} computer to reach one goal. You see it through screenshots and act through the tools.`,
    'Work in small steps. After anything that changes the screen, take a screenshot and check that it did what you meant before going on.',
    'When the target has a visible label (a button, link, menu item, tab), prefer click_text: it finds the label on any display. Use coordinates from the latest screenshot otherwise.',
    'Stop and call finish with outcome "needs_user" when the next step needs the user: a login or password, a payment or purchase, a permission prompt, or a choice the goal does not settle. Never type a password.',
    'Call finish with outcome "done" only when the latest screenshot shows the goal is reached. For a download, show the file: the browser\'s downloads list or the Downloads folder must name it.',
    'Call finish with outcome "cannot_do" when the goal cannot be reached; say what blocked it.',
    'The summary in finish states what the screen shows, not what you intended. Never claim a step you did not see succeed.',
  ].join('\n');
}

const CUSTOM_TOOLS = [
  {
    name: 'click_text',
    description: 'Click a visible label (button, link, menu item) by its text, on any display. Returns what was clicked.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['text'],
      properties: {
        text: { type: 'string', description: 'The label exactly as it appears on screen.' },
        app: { type: 'string', description: 'Only look in this app\'s windows.' },
        nth: { type: 'integer', minimum: 1, description: 'Which match, when the label appears more than once (1 = first).' },
      },
    },
  },
  {
    name: 'read_screen',
    description: 'Read the text on screen with positions, on every display. Use it to find labels or confirm text the screenshot shows too small.',
    input_schema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'finish',
    description: 'End the task. outcome "done" only when the latest screenshot shows the goal reached; "needs_user" when the user must act or decide; "cannot_do" when it cannot be reached.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['outcome', 'summary'],
      properties: {
        outcome: { type: 'string', enum: ['done', 'needs_user', 'cannot_do'] },
        summary: { type: 'string', description: 'What the screen shows now, in one or two sentences.' },
        question: { type: 'string', description: 'For needs_user: what to ask the user.' },
        reason: { type: 'string', enum: ['login', 'payment', 'permission', 'ambiguous', 'other'] },
      },
    },
  },
];

function claudeTools(): unknown[] {
  return [
    { type: 'computer_toolset_20260801', configs: Object.fromEntries(DISABLED_MEMBERS.map((m) => [m, { enabled: false }])) },
    ...CUSTOM_TOOLS,
  ];
}

/** A toolset member's tool_use → an action. */
export function memberToAction(name: string, input: any): OpAction {
  const coord = Array.isArray(input?.coordinate) && input.coordinate.length === 2 ? input.coordinate.map(Number) : null;
  switch (name) {
    case 'screenshot': return { kind: 'screenshot' };
    case 'left_click':
      if (input?.text) return { kind: 'unsupported', name, why: 'clicks with modifier keys are not available; click, then use key' };
      if (!coord) return { kind: 'unsupported', name, why: 'give a coordinate from the latest screenshot' };
      return { kind: 'click', x: coord[0], y: coord[1] };
    case 'type': return { kind: 'type', text: String(input?.text ?? '') };
    case 'key':
      if (Number(input?.repeat ?? 1) > 1) return { kind: 'unsupported', name, why: 'repeat is not available; send the key once per call' };
      return { kind: 'key', keys: String(input?.text ?? '') };
    case 'scroll': return { kind: 'scroll', direction: (['up', 'down', 'left', 'right'].includes(input?.scroll_direction) ? input.scroll_direction : 'down'), amount: Number(input?.scroll_amount ?? 1) };
    case 'wait': return { kind: 'wait', seconds: Number(input?.duration ?? 1) };
    case 'cursor_position': return { kind: 'cursor' };
    default: return { kind: 'unsupported', name, why: 'this action is not available on this computer' };
  }
}

export function usageOf(u: any): Usage {
  return {
    inputTokens: u?.input_tokens ?? 0, outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0, cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
  };
}

type MessagesClient = { messages: { create: (body: any, opts?: any) => Promise<any> } };

export class ClaudeOperator implements OperatorModel {
  readonly label: string;
  private readonly messages: any[] = [];
  /** tool_use ids of the last assistant turn → whether they belong to the toolset. */
  private pending = new Map<string, boolean>();

  constructor(private readonly goal: string, private readonly os: string, private readonly model: string, private readonly client: MessagesClient) {
    this.label = `claude:${model}`;
  }

  async next(results: CallResult[], signal?: AbortSignal): Promise<ModelTurn> {
    const byId = new Map(results.map((r) => [r.id, r]));
    if (this.messages.length === 0) {
      const opening = results.find((r) => r.image);
      this.messages.push({
        role: 'user',
        content: [
          { type: 'text', text: `Goal: ${this.goal}` },
          ...(opening?.image ? [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: opening.image } }] : []),
        ],
      });
    } else {
      const blocks: any[] = [];
      for (const [id, inToolset] of this.pending) {
        const r = byId.get(id);
        const content = r?.image
          ? [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: r.image } }]
          : [{ type: 'text', text: r ? (r.text || (r.ok ? 'OK' : 'failed')) : NOT_EXECUTED }];
        blocks.push({ type: 'tool_result', tool_use_id: id, ...(inToolset ? { toolset_name: TOOLSET } : {}), content, ...(r?.ok ? {} : { is_error: true }) });
      }
      this.messages.push({ role: 'user', content: blocks });
    }

    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      system: operatorSystemPrompt(this.os),
      messages: this.messages,
      tools: claudeTools(),
      thinking: { type: 'adaptive', display: 'updates' },
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      fallbacks: 'default',
    }, { headers: { 'anthropic-beta': ANTHROPIC_BETAS }, signal, timeout: 120_000, maxRetries: 1 });

    const usage = usageOf(res.usage);
    if (res.stop_reason === 'refusal') return { calls: [], usage, refused: res.stop_details?.category ?? 'refused' };
    // Append-only: the assistant turn goes back exactly as it came (thinking blocks included).
    this.messages.push({ role: 'assistant', content: res.content });
    this.pending = new Map();

    const calls: ModelCall[] = [];
    let finish: Finish | undefined;
    let note: string | undefined;
    for (const b of res.content as any[]) {
      if (b.type === 'text' && b.text?.trim()) note = b.text.trim();
      else if (b.type === 'thinking' && b.thinking?.trim()) note = b.thinking.trim();
      else if (b.type === 'tool_use') {
        const inToolset = b.toolset_name === TOOLSET;
        this.pending.set(b.id, inToolset);
        if (inToolset) calls.push({ id: b.id, action: memberToAction(b.name, b.input) });
        else if (b.name === 'click_text') calls.push({ id: b.id, action: { kind: 'click_text', text: String(b.input?.text ?? ''), app: b.input?.app, nth: b.input?.nth } });
        else if (b.name === 'read_screen') calls.push({ id: b.id, action: { kind: 'read_screen' } });
        else if (b.name === 'finish') {
          const o = b.input?.outcome;
          finish = { id: b.id, outcome: o === 'done' || o === 'needs_user' ? o : 'cannot_do', summary: String(b.input?.summary ?? ''), question: b.input?.question, reason: b.input?.reason };
        } else calls.push({ id: b.id, action: { kind: 'unsupported', name: b.name, why: 'unknown tool' } });
      }
    }
    if (!calls.length && !finish) {
      // The model ended its turn without acting or finishing: that is not "done".
      return { calls, usage, note, finish: { id: '', outcome: 'cannot_do', summary: note || 'The operator stopped without finishing the task.' } };
    }
    return { calls, finish, note, usage };
  }
}

// ── UI-TARS 1.5 ────────────────────────────────────────────────────────────────────────

const UITARS_PROMPT = `You are a GUI agent. You are given a task and your action history, with screenshots. You need to perform the next action to complete the task.

## Output Format
\`\`\`
Thought: ...
Action: ...
\`\`\`

## Action Space
click(start_box='<|box_start|>(x1,y1)<|box_end|>')
hotkey(key='ctrl c') # Split keys with a space and use lowercase.
type(content='xxx') # Use escape characters \\', \\", and \\n in content. To submit, end content with \\n.
scroll(start_box='<|box_start|>(x1,y1)<|box_end|>', direction='down or up or right or left')
wait() # Sleep for 5s and take a screenshot to check for any changes.
call_user() # The task needs the user: a login, a payment, a permission, or a choice the task does not settle.
finished(content='xxx') # Only when the screenshot shows the task done. Say what the screen shows.

## Note
- Use English in \`Thought\` part.
- Never type a password.

## User Instruction
`;

/** Width and height from a base64 PNG's IHDR. */
export function pngSize(b64: string): { width: number; height: number } | null {
  try {
    const buf = Buffer.from(b64.slice(0, 64), 'base64');
    if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } catch { return null; }
}

/** Qwen2.5-VL's smart_resize: the pixel space UI-TARS 1.5 answers in. */
export function smartResize(height: number, width: number, factor = 28, minPixels = 100 * 28 * 28, maxPixels = 16384 * 28 * 28): { height: number; width: number } {
  let h = Math.max(factor, Math.round(height / factor) * factor);
  let w = Math.max(factor, Math.round(width / factor) * factor);
  if (h * w > maxPixels) {
    const beta = Math.sqrt((height * width) / maxPixels);
    h = Math.floor(height / beta / factor) * factor; w = Math.floor(width / beta / factor) * factor;
  } else if (h * w < minPixels) {
    const beta = Math.sqrt(minPixels / (height * width));
    h = Math.ceil((height * beta) / factor) * factor; w = Math.ceil((width * beta) / factor) * factor;
  }
  return { height: h, width: w };
}

function unescapeContent(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"');
}

export type UiTarsStep = { thought: string; action: OpAction | { kind: 'finished'; content: string } | { kind: 'call_user' } };

/** Parse one UI-TARS response. Coordinates are scaled from its resized space to the image's. */
export function parseUiTars(text: string, img: { width: number; height: number } | null): UiTarsStep {
  const thought = (text.match(/Thought:\s*([\s\S]*?)(?:\nAction:|$)/)?.[1] ?? '').trim();
  const act = (text.match(/Action:\s*([\s\S]*)$/)?.[1] ?? '').trim();
  const fn = act.match(/^(\w+)\(/)?.[1] ?? '';
  const point = (): { x: number; y: number } | null => {
    const m = act.match(/\((\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\)/) ?? act.match(/<point>(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)<\/point>/);
    if (!m) return null;
    let x = Number(m[1]); let y = Number(m[2]);
    if (img) { const r = smartResize(img.height, img.width); x = (x * img.width) / r.width; y = (y * img.height) / r.height; }
    return { x: Math.round(x), y: Math.round(y) };
  };
  const strArg = (name: string) => { const m = act.match(new RegExp(`${name}='((?:[^'\\\\]|\\\\.)*)'`)); return m ? unescapeContent(m[1]) : ''; };
  switch (fn) {
    case 'click': case 'left_single': { const p = point(); return { thought, action: p ? { kind: 'click', ...p } : { kind: 'unsupported', name: fn, why: 'no coordinate' } }; }
    case 'type': return { thought, action: { kind: 'type', text: strArg('content') } };
    case 'hotkey': return { thought, action: { kind: 'key', keys: strArg('key') } };
    case 'scroll': { const d = strArg('direction'); return { thought, action: { kind: 'scroll', direction: (['up', 'down', 'left', 'right'].includes(d) ? d : 'down') as 'up', amount: 5 } }; }
    case 'wait': return { thought, action: { kind: 'wait', seconds: 5 } };
    case 'finished': return { thought, action: { kind: 'finished', content: strArg('content') } };
    case 'call_user': return { thought, action: { kind: 'call_user' } };
    default: return { thought, action: { kind: 'unsupported', name: fn || 'none', why: 'not an action this computer supports' } };
  }
}

const UITARS_HISTORY_IMAGES = 5;

export class UiTarsOperator implements OperatorModel {
  readonly label: string;
  private readonly history: Array<{ image?: string; reply?: string }> = [];
  private lastImage: { b64: string; size: { width: number; height: number } | null } | null = null;
  private seq = 0;
  private needsLook = false;

  constructor(private readonly goal: string, private readonly baseUrl: string, private readonly model: string, private readonly apiKey?: string, private readonly fetchImpl: typeof fetch = fetch) {
    this.label = `uitars:${model}`;
  }

  async next(results: CallResult[], signal?: AbortSignal): Promise<ModelTurn> {
    const img = [...results].reverse().find((r) => r.image)?.image;
    if (img) { this.lastImage = { b64: img, size: pngSize(img) }; this.history.push({ image: img }); this.needsLook = false; }
    // One action per screenshot: after acting, look before deciding again.
    if (this.needsLook || !this.lastImage) {
      this.needsLook = false;
      return { calls: [{ id: `ut_${++this.seq}`, action: { kind: 'screenshot' } }], usage: { ...ZERO_USAGE } };
    }
    const messages: any[] = [{ role: 'user', content: UITARS_PROMPT + this.goal }];
    const imgIdx = this.history.map((h, i) => (h.image ? i : -1)).filter((i) => i >= 0);
    const keepFrom = imgIdx.length > UITARS_HISTORY_IMAGES ? imgIdx[imgIdx.length - UITARS_HISTORY_IMAGES] : 0;
    this.history.forEach((h, i) => {
      if (h.image && i >= keepFrom) messages.push({ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${h.image}` } }] });
      if (h.reply) messages.push({ role: 'assistant', content: h.reply });
    });
    const r = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({ model: this.model, messages, temperature: 0, max_tokens: 1000 }),
    });
    if (!r.ok) throw new Error(`UI-TARS endpoint ${r.status}`);
    const j: any = await r.json();
    const reply = String(j?.choices?.[0]?.message?.content ?? '');
    this.history.push({ reply });
    const usage = { ...ZERO_USAGE, inputTokens: j?.usage?.prompt_tokens ?? 0, outputTokens: j?.usage?.completion_tokens ?? 0 };
    const step = parseUiTars(reply, this.lastImage.size);
    const id = `ut_${++this.seq}`;
    if (step.action.kind === 'finished') return { calls: [], usage, note: step.thought, finish: { id, outcome: 'done', summary: step.action.content || step.thought } };
    if (step.action.kind === 'call_user') return { calls: [], usage, note: step.thought, finish: { id, outcome: 'needs_user', summary: step.thought, question: step.thought } };
    this.needsLook = true;
    return { calls: [{ id, action: step.action }], usage, note: step.thought };
  }
}

// ── the independent check ──────────────────────────────────────────────────────────────

export interface Verdict { achieved: boolean | null; evidence: string; usage: Usage }

/**
 * A fresh model call that sees only the goal and the final screenshot, never the run's
 * reasoning, and says whether the screen shows the goal reached. `null` = no verdict.
 */
export async function verifyOutcome(client: MessagesClient | null, model: string, goal: string, imageB64: string | null, signal?: AbortSignal): Promise<Verdict> {
  if (!client) return { achieved: null, evidence: 'no checker model is configured', usage: { ...ZERO_USAGE } };
  if (!imageB64) return { achieved: null, evidence: 'no final screenshot', usage: { ...ZERO_USAGE } };
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 4000,
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: { type: 'object', additionalProperties: false, required: ['achieved', 'evidence'], properties: { achieved: { type: 'boolean' }, evidence: { type: 'string' } } },
        },
      },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageB64 } },
          { type: 'text', text: `Goal: ${goal}\n\nDoes this screenshot show the goal reached? Judge only what is visible. "achieved" is true only if the screen itself shows it (for a download: the file is named in a downloads list or folder). "evidence": what on screen decides it, in one sentence.` },
        ],
      }],
    }, { signal, timeout: 60_000, maxRetries: 1 });
    const text = (res.content as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const j = JSON.parse(text);
    return { achieved: typeof j.achieved === 'boolean' ? j.achieved : null, evidence: String(j.evidence ?? ''), usage: usageOf(res.usage) };
  } catch (e: any) {
    return { achieved: null, evidence: `the check could not run (${e?.message ?? 'error'})`, usage: { ...ZERO_USAGE } };
  }
}

export function anthropicClient(): MessagesClient | null {
  const key = process.env.ANTHROPIC_API_KEY;
  return key ? (new Anthropic({ apiKey: key, maxRetries: 1 }) as unknown as MessagesClient) : null;
}
