/**
 * DEF-386 — the operator's action vocabulary, and how each action reaches Suzi's hands.
 *
 * Both operator models (Claude's computer toolset, a self-hosted UI-TARS 1.5) are
 * translated into ONE small action set here, and each action becomes one of Suzi's
 * existing tools. No new protocol on the Mac: screen_capture, click_text, mouse_click,
 * type_text, hotkey, read_screen.
 *
 * Coordinates. The model sees Suzi's screenshot (a ~1280-px PNG) and answers in that
 * image's pixels. Suzi's screen_capture also returns `scale` (image px per screen point)
 * and `origin_x/origin_y` (the display's top-left in screen points), so a screen point is
 *
 *     sx = origin_x + x / scale,   sy = origin_y + y / scale
 *
 * When a capture came back without that metadata, the image pixels are passed through
 * unchanged and the click is Suzi's to place.
 */

export type OpAction =
  | { kind: 'screenshot' }
  | { kind: 'click'; x: number; y: number }
  | { kind: 'click_text'; text: string; app?: string; nth?: number }
  | { kind: 'read_screen' }
  | { kind: 'type'; text: string }
  | { kind: 'key'; keys: string }
  | { kind: 'scroll'; direction: 'up' | 'down' | 'left' | 'right'; amount: number }
  | { kind: 'wait'; seconds: number }
  | { kind: 'cursor' }
  | { kind: 'unsupported'; name: string; why: string };

export interface ModelCall { id: string; action: OpAction }

/** What Suzi's screen_capture returns next to the image. */
export interface CaptureMeta { scale?: number; origin_x?: number; origin_y?: number; pointer_x?: number; pointer_y?: number }

/** One instruction to the gateway: run a Suzi tool, or pause. */
export type GatewayAction =
  | { call_id: string; tool: 'screen_capture' | 'mouse_click' | 'click_text' | 'type_text' | 'hotkey' | 'read_screen'; args: Record<string, unknown> }
  | { call_id: string; wait_ms: number };

/** Actions that change the screen. A `done` needs a screenshot taken after the last one. */
export function isMutating(a: OpAction): boolean {
  return a.kind === 'click' || a.kind === 'click_text' || a.kind === 'type' || a.kind === 'key' || a.kind === 'scroll';
}

export const MAX_WAIT_SECONDS = 10;

/** Image pixel → screen point, using the latest capture's metadata. */
export function toScreen(x: number, y: number, meta: CaptureMeta | null): { x: number; y: number } {
  const scale = meta?.scale;
  if (!meta || typeof scale !== 'number' || !(scale > 0)) return { x: Math.round(x), y: Math.round(y) };
  return { x: Math.round((meta.origin_x ?? 0) + x / scale), y: Math.round((meta.origin_y ?? 0) + y / scale) };
}

/** Screen point → image pixel (for the pointer position the model asks about). */
export function toImage(x: number, y: number, meta: CaptureMeta | null): { x: number; y: number } {
  const scale = meta?.scale;
  if (!meta || typeof scale !== 'number' || !(scale > 0)) return { x: Math.round(x), y: Math.round(y) };
  return { x: Math.round((x - (meta.origin_x ?? 0)) * scale), y: Math.round((y - (meta.origin_y ?? 0)) * scale) };
}

const KEY_ALIASES: Record<string, string> = {
  return: 'enter', kp_enter: 'enter', escape: 'esc', page_down: 'pagedown', next: 'pagedown',
  page_up: 'pageup', prior: 'pageup', super: 'cmd', command: 'cmd', meta: 'cmd', win: 'cmd',
  control: 'ctrl', option: 'alt', backspace: 'backspace', delete: 'delete', del: 'delete',
  arrowdown: 'down', arrowup: 'up', arrowleft: 'left', arrowright: 'right', spacebar: 'space',
};

/** "ctrl+Shift+Return" / "ctrl shift return" → "ctrl+shift+enter" (lower case, '+'-joined). */
export function normaliseKeys(raw: string): string {
  return raw.trim().split(/[+\s]+/).filter(Boolean)
    .map((k) => { const l = k.toLowerCase(); return KEY_ALIASES[l] ?? l; })
    .join('+');
}

/**
 * The Suzi call for one action, or `null` for actions Nexeo answers itself
 * (cursor position, unsupported actions).
 */
export function toGatewayAction(call: ModelCall, meta: CaptureMeta | null, blankApps: string[]): GatewayAction | null {
  const a = call.action;
  switch (a.kind) {
    case 'screenshot':
      return { call_id: call.id, tool: 'screen_capture', args: blankApps.length ? { blank_apps: blankApps } : {} };
    case 'click': {
      const p = toScreen(a.x, a.y, meta);
      return { call_id: call.id, tool: 'mouse_click', args: { x: p.x, y: p.y } };
    }
    case 'click_text':
      return { call_id: call.id, tool: 'click_text', args: { text: a.text, ...(a.app ? { app: a.app } : {}), ...(a.nth ? { nth: a.nth } : {}) } };
    case 'read_screen':
      return { call_id: call.id, tool: 'read_screen', args: {} };
    case 'type':
      return { call_id: call.id, tool: 'type_text', args: { text: a.text } };
    case 'key':
      return { call_id: call.id, tool: 'hotkey', args: { keys: normaliseKeys(a.keys) } };
    case 'scroll':
      // Suzi has no wheel scroll: one page key per call is the honest equivalent.
      return { call_id: call.id, tool: 'hotkey', args: { keys: a.direction === 'up' ? 'pageup' : a.direction === 'down' ? 'pagedown' : a.direction } };
    case 'wait':
      return { call_id: call.id, wait_ms: Math.round(Math.min(Math.max(a.seconds, 0), MAX_WAIT_SECONDS) * 1000) };
    case 'cursor':
    case 'unsupported':
      return null;
  }
}
