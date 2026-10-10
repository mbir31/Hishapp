/**
 * HISAPP — SETTLEMENT STATEMENT IMAGE (JPG) EXPORT
 * ─────────────────────────────────────────────────────────────────
 * Draws a settlement statement on an HTML canvas and saves it as a JPG the
 * doctor can keep, print, or send straight to the clinic owner over
 * WhatsApp / Messenger.
 *
 * The layout is built as a plain list of draw commands
 * (`layoutSettlementStatement`) and only then painted onto a canvas, so the
 * statement can be laid out and asserted in Node tests without a browser.
 */
import { ClinicSettings, Settlement } from '../types';
import {
  buildSettlementStatement,
  settlementImageFileName,
  SettlementStatement,
} from './settlementStatement';

/** Latin UI font first, with Bengali fallbacks for ৳ and the Bangla note. */
export const STATEMENT_FONT_STACK =
  '"Plus Jakarta Sans", "Noto Sans", "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans Bengali", "Nikosh", sans-serif';

export const STATEMENT_MONO_STACK =
  'ui-monospace, "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace';

export function statementFont(size: number, weight = '400'): string {
  return `${weight} ${size}px ${STATEMENT_FONT_STACK}`;
}

export function statementMonoFont(size: number, weight = '500'): string {
  return `${weight} ${size}px ${STATEMENT_MONO_STACK}`;
}

/** Anything that can measure text width for a given font string. */
export type TextMeasurer = (text: string, font: string) => number;

export type TextAlign = 'left' | 'center' | 'right';

export type DrawCommand =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: string; radius?: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | {
      kind: 'text';
      text: string;
      x: number;
      y: number;
      font: string;
      color: string;
      align?: TextAlign;
      letterSpacing?: number;
    }
  | { kind: 'logo'; x: number; y: number; w: number; h: number };

export interface StatementLayout {
  width: number;
  height: number;
  commands: DrawCommand[];
}

export interface LayoutOptions {
  width?: number;
  /** Reserve space for the clinic logo in the header band. */
  withLogo?: boolean;
}

const INK = '#0F172A';
const MUTED = '#64748B';
const SOFT = '#94A3B8';
const BRAND = '#1E1B4B';
const ACCENT = '#4F46E5';
const RULE = '#E2E8F0';

/**
 * Estimates whether the active font stack actually contains a glyph for a
 * character. U+FFFF is a guaranteed non-character that fonts paint as the
 * "missing glyph" box, so a character measuring identically to it is almost
 * certainly absent too. Used to fall back to "Tk" / drop the Bangla paragraph
 * on the rare device without a Bengali font.
 */
export function isGlyphRendered(measure: (text: string) => number, char: string): boolean {
  const missing = measure('\uFFFF');
  const width = measure(char);
  return width > 0 && Math.abs(width - missing) > 0.5;
}

/** Greedy word wrap that uses the supplied measurer. */
export function wrapText(
  measure: TextMeasurer,
  text: string,
  font: string,
  maxWidth: number
): string[] {
  const source = (text || '').replace(/\s+/g, ' ').trim();
  if (!source) return [];

  const lines: string[] = [];
  let current = '';

  const flush = () => {
    if (current) lines.push(current);
    current = '';
  };

  for (const word of source.split(' ')) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate, font) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (!current) {
      // A single word wider than the column: break it hard so nothing spills.
      let chunk = '';
      for (const char of word) {
        if (measure(chunk + char, font) > maxWidth && chunk) {
          lines.push(chunk);
          chunk = char;
        } else {
          chunk += char;
        }
      }
      current = chunk;
      continue;
    }
    flush();
    current = measure(word, font) <= maxWidth ? word : '';
    if (current === '') lines.push(word);
  }
  flush();
  return lines;
}

/** Cuts a string down to the column width and marks it with an ellipsis. */
export function truncateToWidth(
  measure: TextMeasurer,
  text: string,
  font: string,
  maxWidth: number
): string {
  const source = text || '';
  if (measure(source, font) <= maxWidth) return source;

  let cut = source;
  while (cut.length > 1 && measure(`${cut}…`, font) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}…`;
}

/**
 * Lays the statement out into draw commands. `measure` decides wrapping, so
 * the same function runs in a browser (real font metrics) and in tests.
 */
export function layoutSettlementStatement(
  measure: TextMeasurer,
  statement: SettlementStatement,
  options: LayoutOptions = {}
): StatementLayout {
  const width = options.width ?? 900;
  const withLogo = options.withLogo ?? false;
  const margin = 56;
  const contentWidth = width - margin * 2;
  const commands: DrawCommand[] = [];

  const text = (
    value: string,
    x: number,
    y: number,
    font: string,
    color: string,
    align: TextAlign = 'left',
    letterSpacing?: number
  ) => {
    commands.push({ kind: 'text', text: value, x, y, font, color, align, letterSpacing });
  };

  const rule = (y: number, color = RULE) => {
    commands.push({ kind: 'line', x1: margin, y1: y, x2: width - margin, y2: y, color, width: 1 });
  };

  // ── Header band ────────────────────────────────────────────────────
  const headerHeight = withLogo ? 244 : 176;
  commands.push({ kind: 'rect', x: 0, y: 0, w: width, h: headerHeight, color: BRAND });
  commands.push({ kind: 'rect', x: 0, y: headerHeight, w: width, h: 5, color: ACCENT });

  let y = 0;
  if (withLogo) {
    const logoSize = 74;
    commands.push({
      kind: 'logo',
      x: Math.round(width / 2 - logoSize / 2),
      y: 40,
      w: logoSize,
      h: logoSize,
    });
    y = 152;
  } else {
    y = 76;
  }

  text(
    statement.clinicName.toUpperCase(),
    width / 2,
    y,
    statementFont(30, '700'),
    '#FFFFFF',
    'center',
    2
  );
  text(
    statement.documentTitle,
    width / 2,
    y + 40,
    statementFont(17, '600'),
    '#C7D2FE',
    'center',
    6
  );
  text(
    statement.settlementId,
    width / 2,
    y + 74,
    statementMonoFont(15, '500'),
    '#A5B4FC',
    'center',
    1
  );

  y = headerHeight + 44;

  // ── Meta grid (2 columns × 3 rows) ─────────────────────────────────
  const columnWidth = contentWidth / 2;
  const metaRowHeight = 46;
  statement.meta.forEach((field, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const fieldX = margin + column * columnWidth;
    const fieldY = y + row * metaRowHeight;

    text(
      field.label.toUpperCase(),
      fieldX,
      fieldY,
      statementFont(11.5, '700'),
      SOFT,
      'left',
      1.2
    );
    text(
      // Long clinic / doctor names are clipped, never allowed to run into the
      // column beside them.
      truncateToWidth(
        measure,
        field.value,
        statementFont(15.5, '600'),
        columnWidth - 24
      ),
      fieldX,
      fieldY + 22,
      statementFont(15.5, '600'),
      INK,
      'left'
    );
  });

  const metaRows = Math.ceil(statement.meta.length / 2);
  y += metaRows * metaRowHeight + 8;
  rule(y);
  y += 34;

  // ── Financial breakdown ────────────────────────────────────────────
  text('FINANCIAL BREAKDOWN', margin, y, statementFont(13, '700'), ACCENT, 'left', 3);
  y += 14;

  const moneyRowHeight = 44;
  statement.rows.forEach((row) => {
    const isTotal = row.emphasis === 'total';
    const isZeroDue = row.emphasis === 'due' && /\s0$/.test(row.value);

    if (isTotal) {
      commands.push({
        kind: 'rect',
        x: margin,
        y: y - 10,
        w: contentWidth,
        h: moneyRowHeight - 6,
        color: '#EEF2FF',
        radius: 10,
      });
    }

    const labelColor = isTotal ? BRAND : '#334155';
    const labelFont = isTotal ? statementFont(16.5, '700') : statementFont(15.5, '600');
    text(row.label, margin + 14, y + 10, labelFont, labelColor, 'left');

    let valueColor = '#0F172A';
    if (row.emphasis === 'highlight') valueColor = '#4338CA';
    if (row.emphasis === 'total') valueColor = BRAND;
    if (row.emphasis === 'due') valueColor = isZeroDue ? '#047857' : '#B45309';

    text(
      row.value,
      width - margin - 14,
      y + 10,
      statementFont(isTotal ? 18 : 16.5, '700'),
      valueColor,
      'right'
    );

    y += moneyRowHeight;
  });

  y += 6;
  rule(y);
  y += 38;

  // ── Formal statement ───────────────────────────────────────────────
  text('STATEMENT', margin, y, statementFont(13, '700'), ACCENT, 'left', 3);
  y += 12;

  const bodyFont = statementFont(15.5, '400');
  const bodyLines = wrapText(measure, statement.statement, bodyFont, contentWidth);
  bodyLines.forEach((line, index) => {
    text(line, margin, y + 20 + index * 25, bodyFont, '#334155', 'left');
  });
  y += 20 + bodyLines.length * 25 + 12;

  // The Bangla paragraph is omitted entirely when the device cannot render it
  // (see exportSettlementAsImage), so it must not leave a stray gap.
  if (statement.statementBangla) {
    const banglaFont = statementFont(14.5, '400');
    const banglaLines = wrapText(measure, statement.statementBangla, banglaFont, contentWidth);
    banglaLines.forEach((line, index) => {
      text(line, margin, y + 18 + index * 24, banglaFont, MUTED, 'left');
    });
    y += 18 + banglaLines.length * 24;
  }

  if (statement.remarks) {
    y += 18;
    const noteFont = statementFont(13.5, '600');
    const noteLines = wrapText(measure, `Note: ${statement.remarks}`, noteFont, contentWidth - 20);
    noteLines.forEach((line, index) => {
      text(line, margin + 14, y + 16 + index * 22, noteFont, '#475569', 'left');
    });
    commands.push({
      kind: 'rect',
      x: margin,
      y: y + 2,
      w: 4,
      h: noteLines.length * 22 + 12,
      color: '#CBD5E1',
      radius: 2,
    });
    y += 16 + noteLines.length * 22;
  }

  // ── Signature block ────────────────────────────────────────────────
  const signatureWidth = 240;
  y += 78;
  commands.push({
    kind: 'line',
    x1: margin,
    y1: y,
    x2: margin + signatureWidth,
    y2: y,
    color: '#475569',
    width: 1.2,
  });
  commands.push({
    kind: 'line',
    x1: width - margin - signatureWidth,
    y1: y,
    x2: width - margin,
    y2: y,
    color: '#475569',
    width: 1.2,
  });
  text(statement.signatureLeft, margin, y + 22, statementFont(13, '600'), '#475569', 'left');
  text(
    statement.signatureRight,
    width - margin,
    y + 22,
    statementFont(13, '600'),
    '#475569',
    'right'
  );
  y += 22 + 44;

  // ── Footer ─────────────────────────────────────────────────────────
  rule(y);
  text(
    statement.footer,
    width / 2,
    y + 26,
    statementFont(12.5, '600'),
    SOFT,
    'center',
    0.6
  );
  text(
    `Issued on ${statement.generatedOn}`,
    width / 2,
    y + 46,
    statementFont(11.5, '400'),
    SOFT,
    'center'
  );

  const height = Math.round(y + 76);
  return { width, height, commands };
}

/** The narrow drawing surface the layout needs — satisfied by a canvas 2D context. */
export interface Painter {
  fillRect(x: number, y: number, w: number, h: number, color: string, radius?: number): void;
  drawLine(x1: number, y1: number, x2: number, y2: number, color: string, width: number): void;
  drawText(command: Extract<DrawCommand, { kind: 'text' }>): void;
  drawLogo(x: number, y: number, w: number, h: number): void;
}

/** Paints a prepared layout. The logo is skipped when none was loaded. */
export function paintStatementLayout(
  painter: Painter,
  layout: StatementLayout,
  logo?: CanvasImageSource | null
): void {
  for (const command of layout.commands) {
    switch (command.kind) {
      case 'rect':
        painter.fillRect(command.x, command.y, command.w, command.h, command.color, command.radius);
        break;
      case 'line':
        painter.drawLine(command.x1, command.y1, command.x2, command.y2, command.color, command.width);
        break;
      case 'text':
        painter.drawText(command);
        break;
      case 'logo':
        if (logo) painter.drawLogo(command.x, command.y, command.w, command.h);
        break;
    }
  }
}

export interface RenderOptions {
  layoutWidth?: number;
  /** Device-independent scale — 2 keeps text crisp on phones. */
  scale?: number;
  logo?: CanvasImageSource | null;
}

/**
 * Renders the statement into a fresh canvas element (browser only).
 * Returns the canvas so callers can download, share or preview it.
 */
export function renderSettlementStatementCanvas(
  statement: SettlementStatement,
  options: RenderOptions = {}
): HTMLCanvasElement {
  const ctx2dFactory = (canvas: HTMLCanvasElement) => canvas.getContext('2d');
  const measureCanvas = document.createElement('canvas');
  const measureCtx = ctx2dFactory(measureCanvas);
  if (!measureCtx) throw new Error('Canvas 2D context is unavailable in this browser.');

  const measure: TextMeasurer = (text, font) => {
    measureCtx.font = font;
    return measureCtx.measureText(text).width;
  };

  const layout = layoutSettlementStatement(measure, statement, {
    width: options.layoutWidth,
    withLogo: Boolean(options.logo),
  });

  const scale = options.scale ?? 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(layout.width * scale);
  canvas.height = Math.round(layout.height * scale);

  const ctx = ctx2dFactory(canvas);
  if (!ctx) throw new Error('Canvas 2D context is unavailable in this browser.');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, layout.width, layout.height);

  const painter = createCanvasPainterWithLogo(ctx, options.logo ?? null);
  paintStatementLayout(painter, layout, options.logo ?? null);
  return canvas;
}

/** Canvas painter with an explicit logo source. */
export function createCanvasPainterWithLogo(
  ctx: CanvasRenderingContext2D,
  logo: CanvasImageSource | null
): Painter {
  return {
    fillRect(x, y, w, h, color, radius = 0) {
      ctx.fillStyle = color;
      if (radius && radius > 0) {
        ctx.beginPath();
        const r = Math.min(radius, w / 2, h / 2);
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
        ctx.fill();
        return;
      }
      ctx.fillRect(x, y, w, h);
    },
    drawLine(x1, y1, x2, y2, color, width) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    },
    drawText(command) {
      ctx.font = command.font;
      ctx.fillStyle = command.color;
      ctx.textAlign = command.align ?? 'left';
      ctx.textBaseline = 'alphabetic';
      if ('letterSpacing' in ctx) {
        (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${
          command.letterSpacing ?? 0
        }px`;
      }
      ctx.fillText(command.text, command.x, command.y);
      if ('letterSpacing' in ctx) {
        (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px';
      }
    },
    drawLogo(x, y, w, h) {
      if (logo) ctx.drawImage(logo, x, y, w, h);
    },
  };
}

/** Best-effort webfont wait so the exported image uses the app's own typeface. */
async function waitForFonts(): Promise<void> {
  try {
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
    if (fonts?.ready) await fonts.ready;
  } catch {
    /* font loading API unavailable — system fonts are used */
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load the clinic logo'));
    image.src = src;
  });
}

async function canvasToJpegBlob(canvas: HTMLCanvasElement, quality = 0.95): Promise<Blob> {
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((result) => resolve(result), 'image/jpeg', quality)
    );
    if (blob) return blob;
  }
  // Safari / very old browsers: fall back to the data URL.
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export type ExportOutcome = 'shared' | 'downloaded' | 'cancelled';

export interface ExportImageResult {
  fileName: string;
  /** What actually happened to the image — never claim a save that did not occur. */
  outcome: ExportOutcome;
}

/**
 * Builds the settlement statement image and hands it to the phone's share
 * sheet when possible (WhatsApp / Messenger / Drive), otherwise downloads
 * the JPG. Re-renders without the logo if a cross-origin logo taints the
 * canvas, so the export never fails because of the clinic logo.
 */
export async function exportSettlementAsImage(
  settlement: Settlement,
  settings: ClinicSettings
): Promise<ExportImageResult> {
  const fileName = settlementImageFileName(settlement);
  await waitForFonts();

  // Devices without a Bengali font would print the ৳ symbol and the Bangla
  // paragraph as tofu boxes, so we detect support on the real canvas and fall
  // back to "Tk" plus an English-only statement on those rare devices.
  let statement = buildSettlementStatement(settlement, settings);
  const supportCanvas = document.createElement('canvas');
  const supportCtx = supportCanvas.getContext('2d');
  if (supportCtx) {
    const checkFont = statementFont(16);
    const measureFor = (t: string) => {
      supportCtx.font = checkFont;
      return supportCtx.measureText(t).width;
    };
    const bengaliSupported =
      isGlyphRendered(measureFor, '৳') && isGlyphRendered(measureFor, 'ক');
    if (!bengaliSupported) {
      statement = buildSettlementStatement(settlement, settings, {
        currencySymbol: 'Tk',
        includeBangla: false,
      });
    }
  }

  const renderWithLogo = async (logo: CanvasImageSource | null): Promise<Blob> => {
    const canvas = renderSettlementStatementCanvas(statement, { logo });
    return canvasToJpegBlob(canvas);
  };

  let blob: Blob;
  try {
    const logoSrc = (settings.clinicLogo || '').trim();
    const logo = logoSrc ? await loadImage(logoSrc).catch(() => null) : null;
    blob = await renderWithLogo(logo);
  } catch {
    // Tainted canvas (remote logo) — render again without it.
    blob = await renderWithLogo(null);
  }

  const file = new File([blob], fileName, { type: 'image/jpeg' });
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
  };

  if (typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: `Settlement ${statement.settlementId}`,
        text: `${statement.clinicName} — settlement ${statement.settlementId}`,
      });
      return { fileName, outcome: 'shared' };
    } catch (error) {
      // Dismissing the share sheet means "never mind" — nothing is forced onto
      // the device. Any other share failure still falls back to a download.
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { fileName, outcome: 'cancelled' };
      }
    }
  }

  downloadBlob(blob, fileName);
  return { fileName, outcome: 'downloaded' };
}
