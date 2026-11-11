#!/usr/bin/env node
/**
 * theme-codemod — turns hard-coded colours in inline styles and CSS into theme
 * variables, and writes src/styles/theme-colors.css with a dark and a light value
 * for each one.
 *
 * Guarantee: in the dark theme every variable resolves to the exact colour it
 * replaced, so the dark theme is pixel-identical. Light values are computed:
 *   - neutral greys (Lab chroma < 12): lightness inverted (L* -> 100 - L*), which
 *     keeps contrast against the opposite end of the scale;
 *   - saturated colours used as text / borders: darkened to L* <= 50 so they stay
 *     readable on a light surface;
 *   - dark saturated surfaces (L* < 35, e.g. a dark red panel): turned into a pale
 *     tint of the same hue.
 * Left alone on purpose: white backgrounds (QR codes, logos), white/black text on a
 * coloured background, saturated fills, rgba(0,0,0,…) shadows and backdrops, SVG
 * artwork attributes, colour lookup tables and hex + alpha string concatenation.
 *
 * Usage: node scripts/theme-codemod.mjs [--write]   (dry run without --write)
 * Re-running is safe: it only touches literal hex / rgb values, and rewrites the
 * generated CSS from every variable referenced in src.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import postcss from 'postcss';

const traverse = _traverse.default || _traverse;
const WRITE = process.argv.includes('--write');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'src');
const OUT_CSS = path.join(ROOT, 'styles', 'theme-colors.css');
const SKIP_CSS = new Set(['tokens.css', 'theme-colors.css']);
// Pages that are deliberately light in every theme (printable guide on white paper).
const SKIP_FILES = new Set(['pages/ConnectorGuidePage.jsx']);
// SVG artwork attributes stay literal; other colour-carrying JSX props become variables.
const ART_ATTRS = new Set(['fill', 'stroke', 'stopColor', 'floodColor', 'lightingColor']);

// ─── colour maths (sRGB <-> CIE Lab, D65) ─────────────────────────────────────
const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const fromLin = (c) => { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; return Math.round(Math.min(1, Math.max(0, v)) * 255); };
const Xn = 0.95047, Yn = 1, Zn = 1.08883;
const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const fi = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
function rgbToLab([r, g, b]) {
  const R = toLin(r), G = toLin(g), B = toLin(b);
  const X = R * 0.4124 + G * 0.3576 + B * 0.1805;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = R * 0.0193 + G * 0.1192 + B * 0.9505;
  const fx = f(X / Xn), fy = f(Y / Yn), fz = f(Z / Zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function labToRgb([L, a, b]) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const X = fi(fx) * Xn, Y = (L > 8 ? fy ** 3 : L / (24389 / 27)) * Yn, Z = fi(fz) * Zn;
  return [
    fromLin(X * 3.2406 + Y * -1.5372 + Z * -0.4986),
    fromLin(X * -0.9689 + Y * 1.8758 + Z * 0.0415),
    fromLin(X * 0.0557 + Y * -0.204 + Z * 1.057),
  ];
}
const hex6 = (h) => { h = h.replace('#', '').toLowerCase(); return h.length === 3 ? h.split('').map((c) => c + c).join('') : h; };
const hexToRgb = (h) => { h = hex6(h); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const rgbToHex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
const chroma = (lab) => Math.hypot(lab[1], lab[2]);
const isNeutral = (rgb) => chroma(rgbToLab(rgb)) < 12;

const lightNeutral = (rgb) => { const [L, a, b] = rgbToLab(rgb); return rgbToHex(labToRgb([Math.min(96, Math.max(8, 100 - L)), a, b])); };
const lightText = (rgb) => { const [L, a, b] = rgbToLab(rgb); return rgbToHex(labToRgb([Math.min(L, 50), a, b])); };
const lightTint = (rgb) => { const [L, a, b] = rgbToLab(rgb); return rgbToHex(labToRgb([100 - L * 0.5, a * 0.35, b * 0.35])); };

// ─── variable registry ─────────────────────────────────────────────────────────
const vars = new Map(); // name -> { dark, light }
function reg(name, dark, light) { vars.set(name, { dark, light }); return `var(--${name})`; }

// ─── roles from CSS property names ────────────────────────────────────────────
const camel = (p) => p.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function roleOf(prop) {
  const p = camel(prop);
  if (/^(fg|textColor|labelColor|accent|star)$/.test(p)) return 'text';
  if (p === 'bg') return 'bg';
  if (/^(color|fill|caretColor|textDecorationColor|textShadow|columnRuleColor|webkitTextFillColor|WebkitTextFillColor)$/.test(p)) return 'text';
  if (/^background(Color|Image)?$/.test(p)) return 'bg';
  if (/^(border|outline|boxShadow|stroke|accentColor|columnRule|scrollbarColor)/.test(p)) return 'line';
  if (p.startsWith('--')) return 'custom';
  return null;
}

/**
 * Rewrite one value string. `role` is text|bg|line|custom; `onColouredBg` says the
 * same rule/object paints a saturated background (so white/black text stays).
 * Returns { out, changed, kept: [reasons] }.
 */
function rewriteValue(value, role, onColouredBg) {
  const kept = [];
  let out = value.replace(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g, (m, h) => {
    if (h.length === 4) { kept.push(`alpha-hex ${m}`); return m; }
    if (h.length === 8) {
      // #rrggbbaa -> color-mix over the themed base colour, same alpha
      const base = rewriteValue('#' + h.slice(0, 6), role === 'bg' ? 'line' : role, false).out;
      const pct = Math.round((parseInt(h.slice(6), 16) / 255) * 1e6) / 1e4;
      return `color-mix(in srgb, ${base} ${pct}%, transparent)`;
    }
    const hx = hex6(h), rgb = hexToRgb(hx);
    const lab = rgbToLab(rgb);
    if (isNeutral(rgb)) {
      if (role === 'bg' && (hx === 'ffffff')) { kept.push('white background'); return m; }
      if (role === 'text' && onColouredBg && (lab[0] > 90 || lab[0] < 10)) { kept.push('text on coloured bg'); return m; }
      return reg(`n-${hx}`, '#' + hx, lightNeutral(rgb));
    }
    if (role === 'text' || role === 'line') return reg(`s-${hx}`, '#' + hx, lightText(rgb));
    if (role === 'bg' && lab[0] < 35) return reg(`t-${hx}`, '#' + hx, lightTint(rgb));
    kept.push(`saturated ${role}`);
    return m;
  });
  out = out.replace(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(,\s*[\d.]+%?\s*)?\)/g, (m, r, g, b, a) => {
    const rgb = [+r, +g, +b];
    if (!isNeutral(rgb)) { kept.push('saturated rgba'); return m; }
    if (rgb.every((v) => v <= 12)) { kept.push('black rgba (shadow/backdrop)'); return m; }
    const hx = rgbToHex(rgb).slice(1);
    const light = hexToRgb(lightNeutral(rgb)).join(', ');
    reg(`n-${hx}-rgb`, rgb.join(', '), light);
    return `rgba(var(--n-${hx}-rgb)${a ? a : ', 1'})`;
  });
  return { out, changed: out !== value, kept };
}

const SATURATED_BG = /background(Color)?\s*:\s*[^,;}]*(#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|var\(--(accent|danger|success|warning|info)\b)/;
function hasColouredBg(text) {
  const m = text.match(new RegExp(SATURATED_BG.source, 'g')) || [];
  return m.some((s) => {
    if (/var\(--(accent|danger|success|warning|info)\b/.test(s) && !/-dim/.test(s)) return true;
    const h = s.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/);
    if (!h) return false;
    const rgb = hexToRgb(h[1]);
    return !isNeutral(rgb) && rgbToLab(rgb)[0] >= 35;
  });
}

// ─── walk files ────────────────────────────────────────────────────────────────
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } })(ROOT);

const report = { changed: 0, files: 0, kept: {}, skipped: {} };
const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/;

/**
 * Pass 1 — hex + alpha joins. `c + '22'` and `${c}33` only work while c is a hex
 * string; rewrite them as color-mix(), which gives the same colour at the same
 * opacity and also works when c is a var(). Runs before pass 2 so lookup-table
 * colours can then become variables safely.
 */
function joinPass(file) {
  const src = fs.readFileSync(file, 'utf8');
  if (!/\+\s*'[0-9a-fA-F]{2}'|\}[0-9a-fA-F]{2}\b/.test(src)) return;
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });
  const edits = [];
  const pct = (hh) => Math.round((parseInt(hh, 16) / 255) * 1e6) / 1e4;
  traverse(ast, {
    BinaryExpression(p) {
      const n = p.node;
      if (n.operator !== '+' || n.right.type !== 'StringLiteral' || !/^[0-9a-fA-F]{2}$/.test(n.right.value)) return;
      const left = src.slice(n.left.start, n.left.end);
      edits.push({ start: n.start, end: n.end, out: `\`color-mix(in srgb, \${${left}} ${pct(n.right.value)}%, transparent)\`` });
      p.skip();
    },
    TemplateLiteral(p) {
      const { quasis, expressions } = p.node;
      for (let i = 1; i < quasis.length; i++) {
        const q = quasis[i], m = /^([0-9a-fA-F]{2})(?![0-9a-zA-Z])/.exec(q.value.raw);
        if (!m) continue;
        const e = expressions[i - 1];
        const open = src.lastIndexOf('${', e.start);
        edits.push({ start: open, end: open, out: 'color-mix(in srgb, ' });
        edits.push({ start: q.start, end: q.start + 2, out: ` ${pct(m[1])}%, transparent)` });
      }
    },
  });
  apply(file, src, edits);
}

function jsFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  if (!COLOUR.test(src)) return;
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'], errorRecovery: false });
  const edits = [];
  const visit = (p, raw, start) => {
    if (!COLOUR.test(raw)) return;
    // climb to the owning property through value-preserving wrappers
    let cur = p, key = null, why = null;
    for (;;) {
      const parent = cur.parentPath;
      if (!parent) { why = 'no parent'; break; }
      const n = parent.node;
      if (parent.isTemplateLiteral() || parent.isConditionalExpression() || parent.isLogicalExpression()
        || parent.isParenthesizedExpression() || parent.isTSAsExpression?.()) { cur = parent; continue; }
      if (parent.isBinaryExpression({ operator: '+' })) {
        const other = n.left === cur.node ? n.right : n.left;
        const otherStr = other.type === 'StringLiteral' ? other.value : null;
        if (n.left === cur.node && /#[0-9a-fA-F]{3,6}$/.test(raw) && (otherStr === null || /^[0-9a-fA-F]{2}/.test(otherStr))) { why = 'hex + alpha concatenation'; break; }
        cur = parent; continue;
      }
      if (parent.isObjectProperty() && n.value === cur.node) {
        key = n.key.type === 'Identifier' ? n.key.name : n.key.type === 'StringLiteral' ? n.key.value : null;
        if (!key) why = 'computed key';
        break;
      }
      if (parent.isJSXAttribute()) {
        const an = n.name.name;
        if (ART_ATTRS.has(an)) why = `svg artwork attribute ${an}`; else key = an;
        break;
      }
      if (parent.isJSXExpressionContainer()) { cur = parent; continue; }
      if (parent.isCallExpression() || parent.isReturnStatement() || parent.isVariableDeclarator()
        || parent.isAssignmentExpression() || parent.isArrowFunctionExpression() || parent.isArrayExpression()) { key = '(value)'; break; }
      why = `in ${n.type}`; break;
    }
    if (why) { bump(report.skipped, why); return; }
    let role = roleOf(key);
    if (!role) {
      // A colour carried as data (lookup table, helper argument, colour prop). Only a
      // literal that is exactly one colour qualifies, so '#add'-style anchors and
      // selectors inside longer strings are never touched.
      if (!/^(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})$/.test(raw)) { bump(report.skipped, `non-colour data (${key})`); return; }
      role = 'line';
      generic.push(`${path.relative(ROOT, file)}:${src.slice(0, start).split('\n').length} ${key}=${raw}`);
    }
    let objText = '';
    const obj = p.findParent((q) => q.isObjectExpression());
    if (obj) objText = src.slice(obj.node.start, obj.node.end);
    const { out, changed, kept } = rewriteValue(raw, role, role === 'text' && hasColouredBg(objText));
    kept.forEach((k) => bump(report.kept, k));
    if (changed) edits.push({ start, end: start + raw.length, out });
  };
  traverse(ast, {
    StringLiteral(p) { visit(p, src.slice(p.node.start + 1, p.node.end - 1), p.node.start + 1); },
    TemplateElement(p) { visit(p, src.slice(p.node.start, p.node.end), p.node.start); },
  });
  apply(file, src, edits);
}

function cssFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const root = postcss.parse(src);
  const edits = [];
  root.walkDecls((d) => {
    if (!COLOUR.test(d.value)) return;
    const role = roleOf(d.prop) || 'custom';
    const ruleText = d.parent ? d.parent.toString() : '';
    const { out, changed, kept } = rewriteValue(d.value, role, role === 'text' && hasColouredBg(ruleText));
    kept.forEach((k) => bump(report.kept, k));
    if (!changed) return;
    // locate the value inside the original source to keep formatting byte-for-byte
    const declStart = d.source.start.offset;
    const declText = src.slice(declStart, d.source.end.offset + 1);
    const vi = declText.indexOf(d.value, declText.indexOf(':'));
    if (vi < 0) { bump(report.skipped, 'css value not located'); return; }
    edits.push({ start: declStart + vi, end: declStart + vi + d.value.length, out });
  });
  apply(file, src, edits);
}

function apply(file, src, edits) {
  if (!edits.length) return;
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.out + out.slice(e.end);
  report.changed += edits.length; report.files++;
  if (WRITE) fs.writeFileSync(file, out);
  console.log(`${path.relative(ROOT, file)}: ${edits.length}`);
}

const generic = [];
const rel = (f2) => path.relative(ROOT, f2);
if (WRITE) for (const file of files) if (/\.jsx?$/.test(file) && !SKIP_FILES.has(rel(file))) joinPass(file);
for (const file of files) {
  if (SKIP_FILES.has(rel(file))) continue;
  if (/\.(jsx?|mjs)$/.test(file)) jsFile(file);
  else if (/\.css$/.test(file) && !SKIP_CSS.has(path.basename(file))) cssFile(file);
}

// keep variables from earlier runs that are still referenced
if (fs.existsSync(OUT_CSS)) {
  const prev = fs.readFileSync(OUT_CSS, 'utf8');
  const dark = {}, light = {};
  const block = (sel) => (prev.split(sel)[1] || '').split('}')[0];
  for (const [, n, v] of block(':root {').matchAll(/--([\w-]+):\s*([^;]+);/g)) dark[n] = v;
  for (const [, n, v] of block(':root[data-theme="light"] {').matchAll(/--([\w-]+):\s*([^;]+);/g)) light[n] = v;
  const all = files.filter((f2) => /\.(jsx?|css)$/.test(f2) && f2 !== OUT_CSS).map((f2) => fs.readFileSync(f2, 'utf8')).join('\n');
  for (const n of Object.keys(dark)) if (!vars.has(n) && all.includes(`--${n})`)) vars.set(n, { dark: dark[n], light: light[n] });
}

const names = [...vars.keys()].sort();
const css = `/* GENERATED by client/scripts/theme-codemod.mjs — do not edit by hand.
 * One variable per colour that used to be hard-coded. Dark = the original colour,
 * so the dark theme is unchanged; light = the computed counterpart (see the script). */
:root {
${names.map((n) => `  --${n}: ${vars.get(n).dark};`).join('\n')}
}
:root[data-theme="light"] {
${names.map((n) => `  --${n}: ${vars.get(n).light};`).join('\n')}
}
`;
if (WRITE) fs.writeFileSync(OUT_CSS, css);
console.log('\nreplaced', report.changed, 'in', report.files, 'files;', names.length, 'variables');
console.log('kept literal:', report.kept);
console.log('not style values (left alone):', report.skipped);
if (process.argv.includes('--list-data')) console.log('\ncolours converted as data:\n' + generic.join('\n'));
