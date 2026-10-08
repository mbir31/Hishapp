import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ClinicSettings, PatientEntry, Settlement } from '../types';

export interface MonthlySummaryData {
  monthStr: string; // YYYY-MM
  monthName: string; // e.g. "October 2026"
  periodStart: string; // YYYY-MM-01
  periodEnd: string; // YYYY-MM-31
  entries: PatientEntry[];
  settlements: Settlement[];
  totalGross: number;
  totalDoctorShare: number; // 40%
  totalClinicShare: number; // 60%
  patientCount: number;
  amountReceivedByClinic: number;
  previousDue: number;
  outstandingBalance: number;
  procedureBreakdown: { name: string; count: number; gross: number; doctorShare: number }[];
}

export function generateMonthlySummaryData(
  monthStr: string,
  allEntries: PatientEntry[],
  allSettlements: Settlement[],
  allTimePreviousDue: number
): MonthlySummaryData {
  const [year, month] = monthStr.split('-').map(Number);
  const dateObj = new Date(year, month - 1, 1);
  const monthName = dateObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const lastDay = new Date(year, month, 0).getDate();
  const periodStart = `${monthStr}-01`;
  const periodEnd = `${monthStr}-${String(lastDay).padStart(2, '0')}`;

  // Entries within this calendar month
  const monthEntries = allEntries.filter((e) => e.date.startsWith(monthStr));
  monthEntries.sort((a, b) => a.date.localeCompare(b.date) || a.serial - b.serial);

  // Settlements settled within this calendar month
  const monthSettlements = allSettlements.filter((s) => s.settlementDate.startsWith(monthStr));

  const totalGross = monthEntries.reduce((sum, e) => sum + e.receivedAmount, 0);
  const totalDoctorShare = monthEntries.reduce((sum, e) => sum + e.doctorShare, 0);
  const totalClinicShare = totalGross - totalDoctorShare;
  const patientCount = monthEntries.length;

  const amountReceivedByClinic = monthSettlements.reduce((sum, s) => sum + s.amountReceived, 0);

  // Procedure breakdown
  const procMap = new Map<string, { count: number; gross: number; doctorShare: number }>();
  monthEntries.forEach((e) => {
    const pName = e.procedure || 'General Treatment';
    const curr = procMap.get(pName) || { count: 0, gross: 0, doctorShare: 0 };
    procMap.set(pName, {
      count: curr.count + 1,
      gross: curr.gross + e.receivedAmount,
      doctorShare: curr.doctorShare + e.doctorShare,
    });
  });

  const procedureBreakdown = Array.from(procMap.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.doctorShare - a.doctorShare);

  // Outstanding balance for this month:
  // Pending entries in this month (not settled yet)
  const pendingInMonth = monthEntries
    .filter((e) => e.settlementStatus === 'Pending')
    .reduce((sum, e) => sum + e.doctorShare, 0);

  // If there's a settlement in this month, latest due balance; otherwise previous due + pending in month
  let outstandingBalance = 0;
  if (monthSettlements.length > 0) {
    const latestMonthSettlement = monthSettlements[0];
    outstandingBalance = latestMonthSettlement.dueBalance + pendingInMonth;
  } else {
    outstandingBalance = allTimePreviousDue + pendingInMonth;
  }

  return {
    monthStr,
    monthName,
    periodStart,
    periodEnd,
    entries: monthEntries,
    settlements: monthSettlements,
    totalGross,
    totalDoctorShare,
    totalClinicShare,
    patientCount,
    amountReceivedByClinic,
    previousDue: allTimePreviousDue,
    outstandingBalance,
    procedureBreakdown,
  };
}

export function exportMonthlySummaryPDF(data: MonthlySummaryData, settings: ClinicSettings): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const currency = settings.currencySymbol || 'Tk';
  const sharePercent = settings.sharePercentage || 40;
  const clinicPercent = Math.max(0, 100 - sharePercent);
  const fmt = (n: number) => `${currency} ${new Intl.NumberFormat('en-BD').format(Math.round(n))}`;

  const pageWidth = doc.internal.pageSize.getWidth();
  let currentY = 36;

  // Header Background Accent Banner
  doc.setFillColor(30, 27, 75); // Deep Indigo (#1E1B4B)
  doc.rect(0, 0, pageWidth, 90, 'F');

  // Clinic & Doctor Header
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(settings.clinicName || 'Yashfin Dental Care', 36, 38);

  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(199, 210, 254); // Light indigo
  doc.text(`Doctor: ${settings.doctorName || 'Dental Surgeon'}`, 36, 56);
  doc.text(`Compensation Rule: ${sharePercent}% of Collected Patient Billing`, 36, 72);

  // Right-aligned report label
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text('MONTHLY SETTLEMENT REPORT', pageWidth - 36, 38, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(224, 231, 255);
  doc.text(`Month: ${data.monthName}`, pageWidth - 36, 56, { align: 'right' });
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth - 36, 72, { align: 'right' });

  currentY = 110;

  // Section 1: Executive KPI Summary Cards
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text('1. Executive Financial Summary', 36, currentY);

  currentY += 14;

  const cardWidth = (pageWidth - 72 - 30) / 4;
  const cardHeight = 54;

  const kpis = [
    { title: `Doctor's Share (${sharePercent}%)`, value: fmt(data.totalDoctorShare), bg: [238, 242, 255], border: [99, 102, 241], text: [67, 56, 202] },
    { title: 'Gross Billed (100%)', value: fmt(data.totalGross), bg: [248, 250, 252], border: [203, 213, 225], text: [30, 41, 59] },
    { title: 'Patients Treated', value: `${data.patientCount} Visits`, bg: [240, 253, 250], border: [94, 234, 212], text: [13, 148, 136] },
    { title: 'Outstanding Due', value: fmt(data.outstandingBalance), bg: [254, 243, 199], border: [252, 211, 77], text: [180, 83, 9] },
  ];

  kpis.forEach((kpi, idx) => {
    const cardX = 36 + idx * (cardWidth + 10);
    doc.setFillColor(kpi.bg[0], kpi.bg[1], kpi.bg[2]);
    doc.setDrawColor(kpi.border[0], kpi.border[1], kpi.border[2]);
    doc.roundedRect(cardX, currentY, cardWidth, cardHeight, 6, 6, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.title.toUpperCase(), cardX + 8, currentY + 18);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(kpi.text[0], kpi.text[1], kpi.text[2]);
    doc.text(kpi.value, cardX + 8, currentY + 38);
  });

  currentY += cardHeight + 20;

  // Summary Ledger Details Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(36, currentY, pageWidth - 72, 42, 6, 6, 'FD');

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);

  const colW = (pageWidth - 72) / 3;
  doc.text(`Total Period Billing: ${fmt(data.totalGross)}`, 48, currentY + 16);
  doc.text(`Clinic Share (${clinicPercent}%): ${fmt(data.totalClinicShare)}`, 48, currentY + 30);

  doc.text(`Clinic Payouts Cleared: ${fmt(data.amountReceivedByClinic)}`, 48 + colW, currentY + 16);
  doc.text(`Previous Arrears Carried In: ${fmt(data.previousDue)}`, 48 + colW, currentY + 30);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(180, 83, 9);
  doc.text(`Net Outstanding Balance: ${fmt(data.outstandingBalance)}`, 48 + colW * 2, currentY + 16);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(`Settlement Batches: ${data.settlements.length}`, 48 + colW * 2, currentY + 30);

  currentY += 58;

  // Section 2: Procedure Breakdown Table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('2. Procedure & Treatment Breakdown', 36, currentY);

  currentY += 8;

  const procRows = data.procedureBreakdown.map((p) => [
    p.name,
    String(p.count),
    fmt(p.gross),
    fmt(p.doctorShare),
    `${Math.round((p.doctorShare / (data.totalDoctorShare || 1)) * 100)}%`,
  ]);

  if (procRows.length === 0) {
    procRows.push(['No procedures recorded in this month', '0', fmt(0), fmt(0), '0%']);
  }

  autoTable(doc, {
    startY: currentY,
    head: [['Procedure / Treatment', 'Visits', 'Gross Billed', `Doctor's Share (${sharePercent}%)`, '% of Total']],
    body: procRows,
    theme: 'striped',
    headStyles: {
      fillColor: [67, 56, 202],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    styles: {
      fontSize: 8,
      cellPadding: 4,
      textColor: [30, 41, 59],
    },
    columnStyles: {
      0: { cellWidth: 180 },
      1: { halign: 'center' },
      2: { halign: 'right' },
      3: { halign: 'right', fontStyle: 'bold' },
      4: { halign: 'center' },
    },
    margin: { left: 36, right: 36 },
  });

  currentY = (doc as any).lastAutoTable.finalY + 20;

  // Section 3: Itemized Patient Entries
  if (currentY > 640) {
    doc.addPage();
    currentY = 40;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('3. Itemized Patient Records for the Month', 36, currentY);

  currentY += 8;

  const patientRows = data.entries.map((e) => [
    `#${e.serial}`,
    e.date,
    e.patientName || 'Anonymous',
    e.procedure || '',
    fmt(e.receivedAmount),
    fmt(e.doctorShare),
    e.settlementStatus === 'Settled'
      ? `Settled (${e.settlementId || 'Done'})`
      : 'Pending Due',
  ]);

  if (patientRows.length === 0) {
    patientRows.push(['-', '-', 'No patient entries recorded', '-', '-', '-', '-']);
  }

  autoTable(doc, {
    startY: currentY,
    head: [['#', 'Date', 'Patient Name / ID', 'Procedure', 'Total Bill', `Doctor ${sharePercent}%`, 'Status']],
    body: patientRows,
    theme: 'grid',
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
    },
    styles: {
      fontSize: 7.5,
      cellPadding: 3.5,
      textColor: [30, 41, 59],
    },
    columnStyles: {
      0: { cellWidth: 28, halign: 'center' },
      1: { cellWidth: 55 },
      2: { cellWidth: 120 },
      3: { cellWidth: 120 },
      4: { halign: 'right' },
      5: { halign: 'right', fontStyle: 'bold' },
      6: { halign: 'center' },
    },
    margin: { left: 36, right: 36 },
  });

  currentY = (doc as any).lastAutoTable.finalY + 30;

  // Signatures and Verification Footer
  if (currentY > 700) {
    doc.addPage();
    currentY = 60;
  }

  const sigWidth = 180;
  // Left: Doctor Signature
  doc.setDrawColor(148, 163, 184);
  doc.line(36, currentY + 30, 36 + sigWidth, currentY + 30);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text(settings.doctorName || "Doctor's Signature", 36, currentY + 42);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Attending Dental Surgeon', 36, currentY + 52);

  // Right: Clinic Admin Signature
  doc.line(pageWidth - 36 - sigWidth, currentY + 30, pageWidth - 36, currentY + 30);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('Clinic Administrator / Accounts', pageWidth - 36 - sigWidth, currentY + 42);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(settings.clinicName || 'Clinic Management', pageWidth - 36 - sigWidth, currentY + 52);

  // Bottom Notice
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(
    'This statement is generated electronically by Hisapp - Dental Clinic Income & Settlement Tracker. Page certified.',
    pageWidth / 2,
    doc.internal.pageSize.getHeight() - 20,
    { align: 'center' }
  );

  // Save the PDF
  const filename = `Dental_Settlement_Summary_${data.monthStr}.pdf`;
  doc.save(filename);
}
