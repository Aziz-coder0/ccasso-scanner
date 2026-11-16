/**
 * Export without EncodingType.UTF8 (broken on some Expo SDK 54 builds).
 * Tries file write + share; falls back to system Share of CSV text.
 */
import { Share, Platform, Alert } from "react-native";
import * as Sharing from "expo-sharing";

let FileSystem = null;
try {
  FileSystem = require("expo-file-system/legacy");
} catch (_) {
  try {
    FileSystem = require("expo-file-system");
  } catch (_) {
    FileSystem = null;
  }
}

function xmlEscape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function csvEscape(s) {
  const t = String(s ?? "");
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

function sheetXml(sheetName, headers, rows) {
  const headerRow =
    `<Row>` +
    headers.map((h) => `<Cell><Data ss:Type="String">${xmlEscape(h)}</Data></Cell>`).join("") +
    `</Row>`;
  const body = (rows || [])
    .map((row) => {
      return (
        `<Row>` +
        row
          .map((cell) => {
            const v = cell == null ? "" : cell;
            const isNum =
              typeof v === "number" ||
              (/^-?\d+(\.\d+)?$/.test(String(v)) && String(v).length < 16);
            if (isNum && v !== "") {
              return `<Cell><Data ss:Type="Number">${xmlEscape(v)}</Data></Cell>`;
            }
            return `<Cell><Data ss:Type="String">${xmlEscape(v)}</Data></Cell>`;
          })
          .join("") +
        `</Row>`
      );
    })
    .join("");
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="${xmlEscape(sheetName)}">
  <Table>
   ${headerRow}
   ${body}
  </Table>
 </Worksheet>
</Workbook>`;
}

function toCsv(headers, rows) {
  const lines = [];
  if (headers?.length) lines.push(headers.map(csvEscape).join(","));
  for (const row of rows || []) {
    lines.push((row || []).map(csvEscape).join(","));
  }
  return lines.join("\n");
}

async function resolveDir() {
  if (!FileSystem) return "";
  // Sync props first
  let dir =
    FileSystem.cacheDirectory ||
    FileSystem.documentDirectory ||
    "";
  if (dir) return dir;
  // Some builds expose async getters
  try {
    if (typeof FileSystem.getCacheDirectoryAsync === "function") {
      dir = await FileSystem.getCacheDirectoryAsync();
      if (dir) return dir;
    }
  } catch (_) {}
  try {
    if (typeof FileSystem.getDocumentDirectoryAsync === "function") {
      dir = await FileSystem.getDocumentDirectoryAsync();
      if (dir) return dir;
    }
  } catch (_) {}
  return "";
}

async function writeString(path, content) {
  // Never use EncodingType.UTF8 — undefined on some Expo builds
  if (!FileSystem?.writeAsStringAsync) throw new Error("No file writer");
  try {
    await FileSystem.writeAsStringAsync(path, content);
    return;
  } catch (e1) {
    try {
      await FileSystem.writeAsStringAsync(path, content, { encoding: "utf8" });
      return;
    } catch (e2) {
      throw e2 || e1;
    }
  }
}

async function shareTextFallback(fileName, headers, rows) {
  const csv = toCsv(headers, rows);
  const body =
    (fileName || "ccas-export") +
    ".csv\n\n" +
    csv.slice(0, 80000) +
    (csv.length > 80000 ? "\n\n...(truncated)" : "");
  await Share.share({
    message: body,
    title: fileName || "CCAS Export",
  });
  return "shared:text";
}

export async function exportRowsAsXlsx({ fileName, sheetName, headers, rows }) {
  const name = (fileName || "export").replace(/[^\w.\-]+/g, "_");
  const allHeaders = headers || [];
  const allRows = rows || [];
  const xml = sheetXml(sheetName || "Sheet1", allHeaders, allRows);
  const csv = toCsv(allHeaders, allRows);

  const dir = await resolveDir();
  if (dir && FileSystem?.writeAsStringAsync) {
    const pathXls = `${dir}${name}.xls`;
    const pathCsv = `${dir}${name}.csv`;
    try {
      await writeString(pathXls, xml);
      try {
        const can = await Sharing.isAvailableAsync();
        if (can) {
          await Sharing.shareAsync(pathXls, {
            mimeType: "application/vnd.ms-excel",
            dialogTitle: "Export Excel",
            UTI: "com.microsoft.excel.xls",
          });
          return pathXls;
        }
      } catch (_) {}
      await Share.share({
        url: Platform.OS === "ios" ? pathXls : `file://${pathXls}`,
        message: pathXls,
        title: name,
      });
      return pathXls;
    } catch (_) {
      try {
        await writeString(pathCsv, csv);
        const can = await Sharing.isAvailableAsync();
        if (can) {
          await Sharing.shareAsync(pathCsv, {
            mimeType: "text/csv",
            dialogTitle: "Export CSV",
          });
          return pathCsv;
        }
      } catch (_) {}
    }
  }

  // Always-working fallback
  await shareTextFallback(name, allHeaders, allRows);
  return "shared:text";
}

export async function exportKioskBundle({
  session,
  gate,
  operator,
  pending,
  failed,
  history,
  online,
  stats,
}) {
  const meta = [
    ["Field", "Value"],
    ["Session", session?.title || session?.session_name || session?.id || ""],
    ["Session ID", session?.id || ""],
    ["Gate", gate || ""],
    ["Operator", operator || ""],
    ["Mode", online ? "Online" : "Offline"],
    ["Present", stats?.present ?? ""],
    ["Late", stats?.late ?? ""],
    ["Marked", stats?.marked ?? ""],
    ["Exported at", new Date().toISOString()],
  ];
  const pendingRows = (pending || []).map((p) => [
    p.student_code,
    p.session_id,
    p.scanned_at,
    p.client_uid,
    "PENDING",
  ]);
  const failedRows = (failed || []).map((p) => [
    p.student_code,
    p.session_id,
    p.scanned_at,
    p.error || p.code || "",
    "FAILED",
  ]);
  const histRows = (history || []).map((h) => [
    h.student_code || "",
    h.name || "",
    h.status || "",
    h.at || "",
  ]);

  const headers = ["Student code", "Session", "Scanned at", "Detail", "Status"];
  const rows = [
    ...pendingRows,
    ...failedRows,
    ...histRows.map((h) => [h[0], "", h[3], `${h[1]} / ${h[2]}`, "HISTORY"]),
  ];

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  await exportRowsAsXlsx({
    fileName: `ccas-kiosk-${session?.id || "export"}-${stamp}`,
    sheetName: "KioskExport",
    headers,
    rows: [
      ["META", "", "", "", ""],
      ...meta.map((m) => [m[0], m[1], "", "", ""]),
      ["", "", "", "", ""],
      headers,
      ...rows,
    ],
  });
}
