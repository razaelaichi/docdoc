// Synthetic test records for ONE fictional patient (not a real person). Usage:
//   node scripts/generate-sample-records.mjs [outDir]    (default ../samples/arjun-malhotra)
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import PDFDocument from "pdfkit";

const out = path.resolve(process.argv[2] ?? "../samples/arjun-malhotra");
mkdirSync(out, { recursive: true });
const P = { name: "Arjun Malhotra", dob: "14/07/1968", sex: "Male" };

function pdf(file, hospital, title, date, mrn, sections, { scannedPages = [] } = {}) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  doc.on("end", () => writeFileSync(path.join(out, file), Buffer.concat(chunks)));
  const header = () => {
    doc.font("Helvetica-Bold").fontSize(15).text(hospital).font("Helvetica").fontSize(9).fillColor("#444")
      .text("Pune, Maharashtra · Tel 020-5550-0100").fillColor("black").moveDown(0.5)
      .font("Helvetica-Bold").fontSize(13).text(title).moveDown(0.3).font("Helvetica").fontSize(10)
      .text(`Patient Name: ${P.name}`).text(`Date of Birth: ${P.dob}`).text(`Sex: ${P.sex}`).text(`MRN: ${mrn}`).text(`Date: ${date}`).moveDown(0.6);
  };
  header();
  sections.forEach((sec) => {
    if (sec === "PAGEBREAK") return doc.addPage(), header();
    doc.font("Helvetica-Bold").fontSize(11).text(sec[0]).font("Helvetica").fontSize(10);
    for (const line of sec.slice(1)) doc.text(line);
    doc.moveDown(0.5);
  });
  for (const img of scannedPages) doc.addPage().image(img, 30, 30, { width: 535 });
  doc.end();
}

function scan(lines, { width = 1400, font = "34px sans-serif", tint = "#f4f1e8" } = {}) {
  const c = createCanvas(width, 120 + lines.length * 52);
  const g = c.getContext("2d");
  g.fillStyle = tint; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; g.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 2); }
  g.fillStyle = "#1b1b3a"; g.font = font;
  lines.forEach((l, i) => g.fillText(l, 60, 90 + i * 52));
  return c.toBuffer("image/png");
}

function xray() {
  const c = createCanvas(900, 1000), g = c.getContext("2d");
  g.fillStyle = "#000"; g.fillRect(0, 0, 900, 1000);
  const lung = (x) => { const r = g.createRadialGradient(x, 480, 40, x, 480, 330); r.addColorStop(0, "#333"); r.addColorStop(1, "#111"); g.fillStyle = r; g.beginPath(); g.ellipse(x, 480, 170, 330, 0, 0, 7); g.fill(); };
  lung(280); lung(620);
  g.strokeStyle = "#bbb"; g.lineWidth = 14;
  for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse(450, 200 + i * 70, 360, 60, 0, 3.4, 6); g.stroke(); }
  g.fillStyle = "#ccc"; g.fillRect(430, 80, 40, 850); g.beginPath(); g.ellipse(500, 640, 150, 120, 0, 0, 7); g.fill();
  g.fillStyle = "#fff"; g.font = "28px sans-serif"; g.fillText("R", 40, 60); g.fillText("CXR PA 12/03/2024", 560, 970);
  return c.toBuffer("image/png");
}

function dicom(tags) {
  const el = (grp, e, vr, v) => { let b = Buffer.from(v, "latin1"); if (b.length % 2) b = Buffer.concat([b, Buffer.from(vr === "UI" ? "\0" : " ")]); const h = Buffer.alloc(8); h.writeUInt16LE(grp, 0); h.writeUInt16LE(e, 2); h.write(vr, 4, "latin1"); h.writeUInt16LE(b.length, 6); return Buffer.concat([h, b]); };
  return Buffer.concat([Buffer.alloc(128), Buffer.from("DICM"), el(2, 0x10, "UI", "1.2.840.10008.1.2.1"), ...tags.map((t) => el(...t))]);
}

const SUN = "Sunrise Multispeciality Hospital", CITY = "CityCare Diagnostics", LOTUS = "Lotus Heart Institute", NETRA = "Netra Eye Centre";

pdf("01-discharge-summary-2019.pdf", SUN, "Discharge Summary", "22/08/2019", "SMH-448210", [
  ["Admission", "Date of Admission: 18/08/2019", "Date of Discharge: 22/08/2019", "Presenting Complaint: Central chest pain radiating to left arm for 3 hours"],
  ["Diagnosis", "Final Diagnosis: Non-ST elevation myocardial infarction (NSTEMI)", "Comorbidities: Type 2 diabetes mellitus, Hypertension, Dyslipidaemia"],
  ["Allergies", "Allergies: No known drug allergies"],
  ["Investigations", "Troponin I: 2.8 ng/mL (0.0-0.04)", "HbA1c: 8.9 % (4.0-5.6)", "LDL Cholesterol: 162 mg/dL (0-100)", "Serum Creatinine: 1.1 mg/dL (0.7-1.3)"],
  "PAGEBREAK",
  ["Procedure", "Procedure: Coronary angiography with PCI to proximal LAD (1 drug-eluting stent) on 19/08/2019"],
  ["Discharge Medications", "Aspirin: 75 mg once daily", "Clopidogrel: 75 mg once daily", "Atorvastatin: 80 mg at night", "Metoprolol succinate: 25 mg once daily", "Metformin: 500 mg twice daily", "Ramipril: 2.5 mg once daily"],
  ["Advice", "Follow-up: Cardiology OPD in 2 weeks", "Smoking status: Ex-smoker, quit 2015"],
]);
pdf("02-angiography-report-2019.pdf", SUN, "Cardiac Catheterisation Report", "19/08/2019", "SMH-448210", [
  ["Findings", "LAD: 90% proximal stenosis", "LCx: 30% mid-segment disease", "RCA: Non-dominant, normal"],
  ["Intervention", "Stent: Everolimus-eluting stent 3.0 x 28 mm to proximal LAD", "TIMI flow post-procedure: Grade 3"],
  ["Operator", "Interventional Cardiologist: Dr. S. Deshpande"],
]);
const lab = (file, date, id, rows, hospital = CITY) => pdf(file, hospital, "Laboratory Report", date, id, [["Results (reference range in brackets)", ...rows]]);
lab("03-lab-report-2021.pdf", "10/02/2021", "CCD-77120", ["HbA1c: 7.6 % (4.0-5.6)", "Fasting Glucose: 148 mg/dL (70-100)", "LDL Cholesterol: 88 mg/dL (0-100)", "Serum Creatinine: 1.2 mg/dL (0.7-1.3)", "Haemoglobin: 13.8 g/dL (13.5-17.5)"]);
lab("04-lab-report-2023.pdf", "05/06/2023", "CCD-81544", ["HbA1c: 7.1 % (4.0-5.6)", "Fasting Glucose: 131 mg/dL (70-100)", "LDL Cholesterol: 71 mg/dL (0-100)", "Serum Creatinine: 1.4 mg/dL (0.7-1.3)", "eGFR: 58 mL/min/1.73m2 (>90)", "Urine Albumin/Creatinine Ratio: 42 mg/g (0-30)"]);
lab("05-lab-report-2024-citycare.pdf", "12/03/2024", "CCD-90231", ["HbA1c: 7.4 % (4.0-5.6)", "Serum Creatinine: 1.5 mg/dL (0.7-1.3)", "Potassium: 5.1 mmol/L (3.5-5.1)", "Haemoglobin: 12.9 g/dL (13.5-17.5)"]);
lab("06-lab-report-2024-sunrise.pdf", "12/03/2024", "SMH-448210", ["HbA1c: 7.9 % (4.0-5.6)", "Serum Creatinine: 1.5 mg/dL (0.7-1.3)", "TSH: 2.1 mIU/L (0.4-4.0)"], SUN);
lab("07-lab-report-2025.pdf", "18/01/2025", "CCD-95802", ["HbA1c: 6.8 % (4.0-5.6)", "LDL Cholesterol: 64 mg/dL (0-100)", "Serum Creatinine: 1.6 mg/dL (0.7-1.3)", "eGFR: 49 mL/min/1.73m2 (>90)", "Haemoglobin: 12.4 g/dL (13.5-17.5)", "Vitamin B12: 180 pg/mL (200-900)"]);
pdf("08-echocardiogram-2023.pdf", LOTUS, "Transthoracic Echocardiogram", "02/11/2023", "LHI-20931", [
  ["Measurements", "LV Ejection Fraction: 45 %", "LV Wall Motion: Hypokinesia of anterior wall and apex", "Mitral Valve: Mild mitral regurgitation", "RV Function: Normal"],
  ["Impression", "Impression: Mild LV systolic dysfunction, consistent with prior anterior MI"],
]);
pdf("09-chest-xray-report-2024.pdf", SUN, "Radiology Report", "12/03/2024", "SMH-448210", [
  ["Examination", "Examination: Chest X-ray PA view"],
  ["Findings", "Chest X-ray: Mild cardiomegaly, CTR 0.56", "Lung fields: Clear, no consolidation or effusion", "Sternal/Stent: Coronary stent noted in LAD territory"],
  ["Reported by", "Radiologist: Dr. A. Kulkarni"],
]);
writeFileSync(path.join(out, "10-chest-xray-image-2024.png"), xray());
pdf("11-ent-clinic-note-2022.pdf", "Dr. Kapoor ENT & General Clinic", "Clinic Note", "14/09/2022", "KC-3312", [
  ["Visit", "Complaint: Sore throat and fever for 4 days", "Diagnosis: Acute pharyngitis"],
  ["Allergies", "Allergy: Penicillin - generalised rash and itching (2010)"],
  ["Plan", "Azithromycin: 500 mg once daily for 3 days", "Paracetamol: 650 mg as needed"],
]);
writeFileSync(path.join(out, "12-prescription-photo-2024.png"), scan([
  "Dr. R. Iyer, MD (Medicine)      Reg. No. 58213", "Date: 20/04/2024   Pt: Arjun Malhotra, 55 M", "",
  "Diagnosis: Lower respiratory tract infection", "Rx", "1. Amoxicillin: 500 mg three times daily x 5 days",
  "2. Metformin: 1000 mg twice daily", "3. Atorvastatin: 40 mg at night", "4. Aspirin: 75 mg once daily", "5. Pantoprazole: 40 mg before breakfast",
], { font: "36px serif" }));
pdf("13-vaccination-card-scanned.pdf", CITY, "Scanned document", "03/10/2023", "CCD-81544", [], {
  scannedPages: [scan(["IMMUNISATION RECORD - Arjun Malhotra", "", "Influenza vaccine: 03/10/2023 (Batch FLU23-889)", "COVID-19 booster (Covishield): 15/01/2022", "Pneumococcal PCV13: 20/02/2021", "Tetanus (Td): 11/06/2018"])],
});
pdf("14-diabetic-eye-screening-2024.pdf", NETRA, "Retinal Screening Report", "08/07/2024", "NEC-6671", [
  ["Findings", "Right Eye: Mild non-proliferative diabetic retinopathy", "Left Eye: No diabetic retinopathy", "Visual Acuity: 6/9 right, 6/6 left"],
  ["Plan", "Follow-up: Repeat screening in 12 months"],
]);
writeFileSync(path.join(out, "15-ct-chest.dcm"), dicom([[8, 0x20, "DA", "20240315"], [8, 0x60, "CS", "CT"], [0x18, 0x15, "CS", "CHEST"], [8, 0x1030, "LO", "CT CORONARY CALCIUM SCORE"], [8, 0x103e, "LO", "AGATSTON SCORE 412"]]));
writeFileSync(path.join(out, "16-cardiology-followup-photo-2025.png"), scan([
  "LOTUS HEART INSTITUTE - OPD Follow-up   18/01/2025", "Patient: Arjun Malhotra   MRN LHI-20931", "",
  "Blood Pressure: 138/86 mmHg", "Heart Rate: 68 bpm", "Weight: 82 kg", "Assessment: Stable angina CCS class I; CKD stage 3a",
  "Plan: Continue Clopidogrel 75 mg, stop Aspirin", "Dapagliflozin: 10 mg once daily (new)",
]));

writeFileSync(path.join(out, "patient-questionnaire.txt"), `Enter this on the patient upload page (Health questionnaire):

Allergies:     Penicillin | Rash and itching | moderate
               Sulfa drugs | Swelling of lips | severe
Medicines:     Metformin | 1000 mg | twice daily
               Clopidogrel | 75 mg | once daily
               Atorvastatin | 40 mg | at night
               Dapagliflozin | 10 mg | once daily
Conditions:    Type 2 diabetes
               High blood pressure
               Heart attack in 2019
               Kidney problem (told by doctor)
Surgeries:     Angioplasty with stent 2019
               Appendix removed 1989
Family history: Father had heart attack at 58, mother has diabetes
Anything else: I sometimes forget evening Metformin. I get breathless climbing 2 floors.
`);
console.log(`Wrote synthetic records for fictional patient ${P.name} to ${out}`);
