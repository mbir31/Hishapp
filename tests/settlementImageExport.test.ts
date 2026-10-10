/**
 * Exercises the real JPG export path (`exportSettlementAsImage`) with a
 * stand-in canvas, so layout, painting, JPEG encoding and the save/share
 * hand-off are all covered without a browser.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ClinicSettings, Settlement } from '../src/types';
import { exportSettlementAsImage } from '../src/utils/settlementImageExport';

const settings: ClinicSettings = {
  clinicName: 'Yashfin Dental Care',
  clinicLogo: '', // no logo → no Image loading needed
  doctorName: 'Dr. Test Surgeon',
  currencySymbol: '৳',
  sharePercentage: 40,
  autoBackup: true,
};

const settlement: Settlement = {
  settlementId: 'ST-20261010-02',
  settlementDate: '2026-10-10',
  periodFrom: '2026-09-26',
  periodTo: '2026-10-10',
  patientCount: 8,
  periodShare: 6000,
  previousDue: 0,
  totalPayable: 6000,
  amountReceived: 6000,
  dueBalance: 0,
  remarks: '',
  patientIds: ['entry-1', 'entry-2'],
  createdAt: 1791547200000,
};

interface FakeCanvas {
  width: number;
  height: number;
  drawn: string[];
}

/** Node exposes `navigator` as a getter-only global, so it needs redefining. */
function defineNavigator(value: Record<string, unknown>): void {
  Object.defineProperty(globalThis, 'navigator', {
    value,
    configurable: true,
    writable: true,
  });
}

function installFakeDom(): { canvases: FakeCanvas[]; downloads: string[] } {
  const canvases: FakeCanvas[] = [];
  const downloads: string[] = [];

  const createCanvas = () => {
    const canvas: FakeCanvas = { width: 0, height: 0, drawn: [] };
    canvases.push(canvas);
    const ctx = {
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      textAlign: 'left',
      textBaseline: 'alphabetic',
      // The notdef box (U+FFFF) measures narrower than real glyphs, so the
      // export keeps ৳ and the Bangla paragraph by default.
      measureText: (text: string) => ({
        width: text === '\uFFFF' ? 5 : text.length * 7,
      }),
      fillText: (text: string) => canvas.drawn.push(text),
      fillRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      arcTo: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      setTransform: () => {},
      drawImage: () => {},
    };
    return Object.assign(canvas, {
      getContext: () => ctx,
      toBlob: (callback: (blob: Blob | null) => void) =>
        callback(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })),
    });
  };

  const anyGlobal = globalThis as unknown as Record<string, unknown>;
  anyGlobal.document = {
    createElement: (tag: string) => {
      if (tag === 'canvas') return createCanvas();
      return {
        href: '',
        download: '',
        rel: '',
        click: () => downloads.push((anyGlobal.__lastAnchor as { download: string }).download),
        remove: () => {},
      };
    },
    body: { appendChild: (anchor: { download: string }) => (anyGlobal.__lastAnchor = anchor) },
    fonts: { ready: Promise.resolve() },
  };
  anyGlobal.URL = {
    createObjectURL: () => 'blob:fake-settlement',
    revokeObjectURL: () => {},
  };
  defineNavigator({});

  return { canvases, downloads };
}

test('a settlement exports as a downloadable JPG statement', async () => {
  const { canvases, downloads } = installFakeDom();

  const result = await exportSettlementAsImage(settlement, settings);

  assert.equal(result.fileName, 'Hisapp_Settlement_ST-20261010-02.jpg');
  assert.equal(result.outcome, 'downloaded');
  assert.deepEqual(downloads, ['Hisapp_Settlement_ST-20261010-02.jpg']);

  // Three canvases: the font-support probe, one for measuring text, and the
  // rendered image at 2× (the last one created).
  assert.equal(canvases.length, 3);
  const image = canvases[canvases.length - 1];
  assert.equal(image.width, 1800);
  assert.ok(image.height > 1800, `expected a portrait image, got ${image.height}`);

  // The formal statement text really reached the canvas.
  // Lines are wrapped, so they are rejoined before matching whole sentences.
  const drawn = image.drawn.join(' ').replace(/\s+/g, ' ');
  for (const expected of [
    'YASHFIN DENTAL CARE',
    'CLINICAL SETTLEMENT STATEMENT',
    'ST-20261010-02',
    'Dr. Test Surgeon',
    'Total Payable to Doctor',
    '৳ 6,000',
    'This is to certify that the above statement',
    'the account stands fully cleared with no outstanding due',
    'Signature of Doctor',
    'Signature of Clinic Authority',
  ]) {
    assert.ok(drawn.includes(expected), `the image is missing "${expected}"`);
  }
});

test('phones with a share sheet get the image there instead of a download', async () => {
  const { downloads } = installFakeDom();
  let sharedFiles: File[] = [];
  defineNavigator({
    canShare: (data: { files: File[] }) => Array.isArray(data.files),
    share: async (data: { files: File[] }) => {
      sharedFiles = data.files;
    },
  });

  const result = await exportSettlementAsImage(settlement, settings);

  assert.equal(result.outcome, 'shared');
  assert.deepEqual(downloads, []);
  assert.equal(sharedFiles.length, 1);
  assert.equal(sharedFiles[0].name, 'Hisapp_Settlement_ST-20261010-02.jpg');
  assert.equal(sharedFiles[0].type, 'image/jpeg');
});

test('dismissing the share sheet saves nothing and reports it honestly', async () => {
  const { downloads } = installFakeDom();
  defineNavigator({
    canShare: () => true,
    share: async () => {
      throw new DOMException('User dismissed the share sheet', 'AbortError');
    },
  });

  const result = await exportSettlementAsImage(settlement, settings);

  assert.equal(result.outcome, 'cancelled');
  assert.deepEqual(downloads, []);
});
