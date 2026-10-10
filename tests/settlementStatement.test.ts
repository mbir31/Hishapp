import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ClinicSettings, Settlement } from '../src/types';
import {
  buildSettlementStatement,
  formatStatementAmount,
  settlementImageFileName,
} from '../src/utils/settlementStatement';
import {
  DrawCommand,
  layoutSettlementStatement,
  Painter,
  paintStatementLayout,
  StatementLayout,
  isGlyphRendered,
  truncateToWidth,
  wrapText,
} from '../src/utils/settlementImageExport';

const settings: ClinicSettings = {
  clinicName: 'Yashfin Dental Care',
  clinicLogo: '/dlogo.png',
  doctorName: 'Dr. Test Surgeon',
  currencySymbol: '৳',
  sharePercentage: 40,
  autoBackup: true,
};

const settlement: Settlement = {
  settlementId: 'ST-20261010-01',
  settlementDate: '2026-10-10',
  periodFrom: '2026-10-01',
  periodTo: '2026-10-10',
  patientCount: 12,
  periodShare: 8400,
  previousDue: 1600,
  totalPayable: 10000,
  amountReceived: 7000,
  dueBalance: 3000,
  remarks: 'Paid via bKash, balance next Thursday',
  patientIds: ['entry-1'],
  createdAt: 1791547200000,
};

/** Deterministic stand-in for canvas font metrics: ~0.5em per character. */
const measure: (text: string, font: string) => number = (text, font) => {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
  return text.length * size * 0.5;
};

const textCommands = (layout: StatementLayout) =>
  layout.commands.filter((command): command is Extract<DrawCommand, { kind: 'text' }> => command.kind === 'text');

test('amounts are rounded to whole taka and carry the currency symbol', () => {
  assert.equal(formatStatementAmount('৳', 0), '৳ 0');
  assert.equal(formatStatementAmount('৳', 1000), '৳ 1,000');
  assert.equal(formatStatementAmount('৳', 10000), '৳ 10,000');

  // Fractional taka are rounded away; digit grouping itself comes from the
  // runtime's locale data, so only the digits are asserted here.
  const big = formatStatementAmount('৳', 1234567.6);
  assert.ok(big.startsWith('৳ '), big);
  assert.equal(big.replace(/\D/g, ''), '1234568');
});

test('the statement carries the clinic figures and a formal certification', () => {
  const statement = buildSettlementStatement(settlement, settings, { now: new Date(2026, 9, 10, 18, 30) });

  assert.equal(statement.documentTitle, 'CLINICAL SETTLEMENT STATEMENT');
  assert.equal(statement.settlementId, 'ST-20261010-01');
  assert.equal(statement.clinicName, 'Yashfin Dental Care');
  assert.equal(statement.doctorName, 'Dr. Test Surgeon');
  assert.equal(statement.patientCount, 12);

  assert.deepEqual(
    statement.rows.map((row) => [row.label, row.value, row.emphasis]),
    [
      ["Doctor's Professional Share (40%)", '৳ 8,400', 'highlight'],
      ['Previous Carry-over Due', '৳ 1,600', 'normal'],
      ['Total Payable to Doctor', '৳ 10,000', 'total'],
      ['Amount Received from Clinic', '৳ 7,000', 'normal'],
      ['Due Carried Forward', '৳ 3,000', 'due'],
    ]
  );

  assert.match(statement.statement, /^This is to certify/);
  assert.match(statement.statement, /Yashfin Dental Care/);
  assert.match(statement.statement, /12 patient visits/);
  assert.match(statement.statement, /৳ 3,000, which shall be carried forward/);
  assert.match(statement.statementBangla, /৳ 10,000/);
  assert.equal(statement.remarks, 'Paid via bKash, balance next Thursday');
  assert.equal(statement.signatureLeft, 'Signature of Doctor');
  assert.equal(statement.signatureRight, 'Signature of Clinic Authority');
  assert.equal(statement.generatedOn, '10 Oct 2026, 18:30');
  assert.equal(settlementImageFileName(settlement), 'Hisapp_Settlement_ST-20261010-01.jpg');
});

test('the wording follows the balance: due, cleared or advance', () => {
  const cleared = buildSettlementStatement({ ...settlement, amountReceived: 10000, dueBalance: 0 }, settings);
  assert.match(cleared.statement, /the account stands fully cleared with no outstanding due/);

  const advance = buildSettlementStatement({ ...settlement, amountReceived: 12000, dueBalance: -2000 }, settings);
  assert.match(advance.statement, /an advance of ৳ 2,000 paid by the clinic/);

  const single = buildSettlementStatement({ ...settlement, patientCount: 1 }, settings);
  assert.match(single.statement, /covering 1 patient visit\./);
});

test('missing clinic or doctor names fall back instead of printing blanks', () => {
  const statement = buildSettlementStatement(settlement, {
    ...settings,
    clinicName: '  ',
    doctorName: '',
  });
  assert.equal(statement.clinicName, 'Dental Clinic');
  assert.equal(statement.doctorName, '—');
  assert.match(statement.statement, /at Dental Clinic during the period/);
});

test('long words are wrapped so nothing spills off the page', () => {
  const font = '400 10px sans-serif';
  assert.deepEqual(wrapText(measure, '', font, 100), []);
  assert.deepEqual(wrapText(measure, 'one two three', font, 100), ['one two three']);
  assert.deepEqual(wrapText(measure, 'one two three', font, 60), ['one two', 'three']);
  // 10px font × 0.5em per character → six characters fit in 30px.
  assert.deepEqual(wrapText(measure, 'supercalifragilistic', font, 30), [
    'superc',
    'alifra',
    'gilist',
    'ic',
  ]);
});

test('over-long clinic and doctor names are clipped inside their column', () => {
  const font = '400 10px sans-serif';
  assert.equal(truncateToWidth(measure, 'Short', font, 100), 'Short');

  const clipped = truncateToWidth(measure, 'An Extremely Long Clinic Name', font, 60);
  assert.ok(clipped.endsWith('…'), clipped);
  assert.ok(measure(clipped, font) <= 60, `"${clipped}" is ${measure(clipped, font)}px wide`);

  const statement = buildSettlementStatement(settlement, {
    ...settings,
    clinicName: 'Yashfin Dental Care And Maxillofacial Surgical Institute',
  });
  const layout = layoutSettlementStatement(measure, statement, { width: 900 });
  const columnWidth = (900 - 56 * 2) / 2 - 24;
  // Meta column values are the ink-coloured 15.5px lines (the paragraph is
  // full width and a different colour, so it must not be measured as a column).
  const metaValues = textCommands(layout).filter(
    (command) => command.font.includes('15.5px') && command.color === '#0F172A'
  );
  assert.ok(metaValues.length > 0);
  for (const command of metaValues) {
    assert.ok(
      measure(command.text, command.font) <= columnWidth,
      `"${command.text}" overflows its column`
    );
  }
  assert.ok(
    metaValues.some((command) => command.text.endsWith('…')),
    'the long clinic name was not clipped'
  );
});

test('the statement layout draws every figure as text inside the page', () => {
  const statement = buildSettlementStatement(settlement, settings, { now: new Date(2026, 9, 10) });
  const layout = layoutSettlementStatement(measure, statement, { width: 900 });

  assert.equal(layout.width, 900);
  assert.ok(layout.height > 900, `expected a portrait page, got ${layout.height}`);

  const texts = textCommands(layout).map((command) => command.text);
  for (const expected of [
    'YASHFIN DENTAL CARE',
    'CLINICAL SETTLEMENT STATEMENT',
    'ST-20261010-01',
    'FINANCIAL BREAKDOWN',
    "Doctor's Professional Share (40%)",
    '৳ 8,400',
    'Total Payable to Doctor',
    '৳ 10,000',
    'Due Carried Forward',
    '৳ 3,000',
    'STATEMENT',
    'Signature of Doctor',
    'Signature of Clinic Authority',
    'Note: Paid via bKash, balance next Thursday',
  ]) {
    assert.ok(texts.includes(expected), `missing "${expected}" in the rendered statement`);
  }

  // Nothing is drawn outside the page or above the top edge.
  for (const command of layout.commands) {
    if (command.kind === 'text') {
      assert.ok(command.x >= 0 && command.x <= layout.width, `text outside page: ${command.text}`);
      assert.ok(command.y > 0 && command.y <= layout.height, `text outside page: ${command.text}`);
    }
    if (command.kind === 'rect') {
      assert.ok(command.x + command.w <= layout.width + 1, 'rectangle wider than the page');
    }
  }

  // The certification paragraph is wrapped into several in-page lines.
  const paragraph = textCommands(layout).filter((command) => command.color === '#334155');
  assert.ok(paragraph.length >= 4, `expected a wrapped paragraph, got ${paragraph.length} lines`);
  for (const line of paragraph) {
    assert.ok(measure(line.text, line.font) <= layout.width, 'wrapped line too wide');
  }

  // The "Total Payable" row is highlighted with its own panel.
  assert.ok(layout.commands.some((command) => command.kind === 'rect' && command.color === '#EEF2FF'));
});

test('a logo is only reserved when the clinic actually has one', () => {
  const statement = buildSettlementStatement(settlement, settings);

  const withLogo = layoutSettlementStatement(measure, statement, { withLogo: true });
  const withoutLogo = layoutSettlementStatement(measure, statement, { withLogo: false });

  assert.equal(withLogo.commands.filter((command) => command.kind === 'logo').length, 1);
  assert.equal(withoutLogo.commands.filter((command) => command.kind === 'logo').length, 0);
  assert.ok(withLogo.height > withoutLogo.height, 'the logo band should make the page taller');
});

/** Records what the renderer asked for, standing in for a canvas context. */
class RecordingPainter implements Painter {
  public rects: string[] = [];
  public lines = 0;
  public texts: string[] = [];
  public logos = 0;

  fillRect(x: number, y: number, w: number, h: number, color: string): void {
    this.rects.push(`${Math.round(x)},${Math.round(y)} ${Math.round(w)}x${Math.round(h)} ${color}`);
  }
  drawLine(): void {
    this.lines += 1;
  }
  drawText(command: Extract<DrawCommand, { kind: 'text' }>): void {
    this.texts.push(command.text);
  }
  drawLogo(): void {
    this.logos += 1;
  }
}

test('painting the layout draws every command, and skips a missing logo', () => {
  const statement = buildSettlementStatement(settlement, settings);
  const layout = layoutSettlementStatement(measure, statement, { withLogo: true });

  const withLogo = new RecordingPainter();
  paintStatementLayout(withLogo, layout, {} as CanvasImageSource);
  assert.equal(withLogo.logos, 1);
  assert.equal(withLogo.texts.length, textCommands(layout).length);
  assert.equal(
    withLogo.rects.length,
    layout.commands.filter((command) => command.kind === 'rect').length
  );
  assert.equal(withLogo.lines, layout.commands.filter((command) => command.kind === 'line').length);

  const withoutLogo = new RecordingPainter();
  paintStatementLayout(withoutLogo, layout, null);
  assert.equal(withoutLogo.logos, 0);
  assert.equal(withoutLogo.texts.length, textCommands(layout).length);
});

test('glyph detection flags missing Bengali characters', () => {
  // ৳ measures differently from the notdef box → treated as present.
  assert.equal(
    isGlyphRendered((t) => (t === '\uFFFF' ? 8 : 10), '৳'),
    true
  );
  // ৳ measures exactly like the notdef box → treated as missing.
  assert.equal(
    isGlyphRendered((t) => (t === '\uFFFF' ? 8 : 8), '৳'),
    false
  );
  // Zero-width character is never considered rendered.
  assert.equal(isGlyphRendered(() => 0, '৳'), false);
});

test('the builder honours currency and Bangla overrides', () => {
  const fallback = buildSettlementStatement(settlement, settings, {
    currencySymbol: 'Tk',
    includeBangla: false,
  });
  assert.equal(fallback.statementBangla, '');
  assert.deepEqual(
    fallback.rows.map((row) => row.value),
    ['Tk 8,400', 'Tk 1,600', 'Tk 10,000', 'Tk 7,000', 'Tk 3,000']
  );

  const withBangla = buildSettlementStatement(settlement, settings);
  assert.ok(withBangla.statementBangla.length > 0);
});
