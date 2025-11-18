// src/lib/files/pdfReader.ts

import * as pdfParse from "pdf-parse";
import type { ParsedDocument } from "./types";

export async function parsePdf(
  buffer: Buffer,
  fileName: string
): Promise<ParsedDocument> {
  // pdf-parse のエクスポート形式に両対応
  const parser: any =
    (pdfParse as any).default && typeof (pdfParse as any).default === "function"
      ? (pdfParse as any).default
      : typeof pdfParse === "function"
      ? (pdfParse as any)
      : null;

  if (!parser) {
    throw new Error("pdf-parse の読み込みに失敗しました");
  }

  const result = await parser(buffer);

  return {
    text: result?.text ?? "",
    meta: {
      fileName,
      mimeType: "application/pdf",
      pageCount: (result as any)?.numpages ?? undefined,
    },
  };
}
