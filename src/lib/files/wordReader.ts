import mammoth from "mammoth";
import { ParsedDocument } from "./types";

export async function parseWord(buffer: Buffer, fileName: string): Promise<ParsedDocument> {
  const result = await mammoth.extractRawText({ buffer });
  return {
    text: result.value || "",
    meta: {
      fileName,
      fileType: "word",
    },
  };
}