// src/lib/files/pptReader.ts
import { ParsedDocument } from "./types";

export async function parsePpt(buffer: Buffer, fileName: string): Promise<ParsedDocument> {
  // TODO: 本実装
  return {
    text: "(PPT解析は未実装です。現状はファイル名のみ表示します。)",
    meta: {
      fileName,
      fileType: "ppt",
    },
  };
}