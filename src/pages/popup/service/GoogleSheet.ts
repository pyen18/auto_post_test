import * as functions from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { google } from "googleapis";
import * as path from "path";

// Node 18+ có fetch global, nếu dùng Node 16 thì cài node-fetch và import
// import fetch from "node-fetch";

admin.initializeApp();

// Realtime Database
const db = admin.database();

// ====== Google Sheets config ======
// CHỈ là ID của sheet (không phải URL):
// Ví dụ: https://docs.google.com/spreadsheets/d/1AbCDEFghiJKL.../edit
// => SHEET_ID = "1AbCDEFghiJKL..."
const SHEET_ID = "1T63bvtsoK_-ChZc-A1R7l1jHLoLtQgknLc2wgMzjJsw";
const RANGE = "Posts!A:E"; // A=rowId, B=content, C=time, D=mediaUrls, E=status

// URL CSV public export (Publish to web → CSV)
const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRgvUaPLvI5hb35mqbVASImB5dHZOUtiVVNCqU2L0pxFDRDG1E4YPbLhk_uCCp9yWvWwWJufhjGqnXg/pub?output=csv";

// Auth Google Sheets (service account)
const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, "../keys/service-account.json"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

type Job = {
  rowId: string;
  content: string;
  mediaUrls: string[];
  time: string; // expect "HH:mm"
  status: "pending" | "done" | "failed";
};

function parseCsv(csv: string): Job[] {
  const lines = csv.trim().split(/\r?\n/);
  const rows = lines.slice(1);
  const jobs: Job[] = [];
  for (const row of rows) {
    // Simple CSV split; if your sheet content contains commas, switch to a real CSV parser
    const cols = row.split(",").map((s) => s.trim());
    const [rowId, content, time, mediaUrlsRaw = "", statusRaw = ""] = cols;
    if (!rowId || !content || !time) continue;
    const mediaUrls = mediaUrlsRaw
      .split(";")
      .map((u) => u.trim())
      .filter(Boolean);
    const status: Job["status"] =
      statusRaw.toLowerCase().includes("done") || statusRaw.includes("đã")
        ? "done"
        : "pending";
    jobs.push({ rowId, content, mediaUrls, time, status });
  }
  return jobs;
}

// ===== Function 1: Đồng bộ Google Sheets → Firebase mỗi 5 phút =====
export const syncScheduleFromSheet = onSchedule("every 5 minutes", async () => {
  try {
    console.log("[syncScheduleFromSheet] start");
    const res = await fetch(SHEET_CSV_URL);
    if (!res.ok) throw new Error(`Failed to fetch sheet: ${res.status}`);
    const csv = await res.text();
    const jobs = parseCsv(csv);

    const updates: Record<string, Job> = {};
    for (const job of jobs) updates[job.rowId] = job;

    await db.ref("autoPosts").update(updates);
    console.log(`✅ Synced ${jobs.length} jobs from sheet to Firebase`);
  } catch (err) {
    console.error("[syncScheduleFromSheet] error:", err);
  }
});

// ===== Function 2: Tick "Đã đăng" (Firebase + Google Sheet) =====
export const markPosted = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }
  const { rowId } = req.body as { rowId?: string };
  if (!rowId) {
    res.status(400).json({ ok: false, error: "Missing rowId" });
    return;
  }
  try {
    const sheets = google.sheets({ version: "v4", auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: RANGE,
    });
    const rows: string[][] = (response.data.values as string[][]) || [];
    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if ((rows[i][0] || "").trim() === rowId) {
        rowIndex = i;
        break;
      }
    }
    if (rowIndex === -1) {
      res.status(404).json({ ok: false, error: "Row not found" });
      return;
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Posts!E${rowIndex + 1}`,
      valueInputOption: "RAW",
      requestBody: { values: [["✅ Đã đăng"]] },
    });
    await db.ref(`autoPosts/${rowId}/status`).set("done");
    console.log(`✅ Updated rowId ${rowId} as done`);
    res.json({ ok: true, rowId });
  } catch (error) {
    console.error("[markPosted] error:", error);
    res.status(500).json({ ok: false, error: "Update failed" });
  }
});

// ===== Function 3: Worker check job đến giờ đăng =====
export const autoPostWorker = onSchedule("every 1 minutes", async () => {
  try {
    const snapshot = await db.ref("autoPosts").once("value");
    const jobs: Record<string, Job> = snapshot.val() || {};
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    for (const rowId in jobs) {
      const job = jobs[rowId];
      if (!job || job.status !== "pending") continue;
      const parts = (job.time || "").split(":").map(Number);
      if (parts.length < 2) continue;
      const [hh, mm] = parts;
      if (isNaN(hh) || isNaN(mm)) continue;
      const jobMinutes = hh * 60 + mm;
      if (Math.abs(jobMinutes - currentMinutes) <= 1) {
        await db.ref(`triggers/${rowId}`).set({
          rowId,
          content: job.content,
          mediaUrls: job.mediaUrls || [],
          createdAt: Date.now(),
        });
        console.log(`🚀 Trigger created for job ${rowId}`);
      }
    }
  } catch (err) {
    console.error("[autoPostWorker] error:", err);
  }
});