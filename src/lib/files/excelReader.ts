import ExcelJS from "exceljs";
import { ParsedDocument } from "./types";

export async function parseExcel(buffer: Buffer, fileName: string): Promise<ParsedDocument> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];

  let lines: string[] = [];
  const maxRows = Math.min(sheet.rowCount, 500); // とりあえず上から500行まで

  for (let i = 1; i <= maxRows; i++) {
    const row = sheet.getRow(i);
    const values = row.values
      .filter((v) => v !== null && v !== undefined && v !== "")
      .map((v) => (typeof v === "object" && "text" in (v as any) ? (v as any).text : String(v)));
    if (values.length > 0) {
      lines.push(values.join(" | "));
    }
  }

  return {
    text: lines.join("\n"),
    meta: {
      fileName,
      fileType: "excel",
    },
  };
}