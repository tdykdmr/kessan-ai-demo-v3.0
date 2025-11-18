import { NextRequest, NextResponse } from "next/server";
import { parsePdf } from "@/lib/files/pdfReader";
import { parseWord } from "@/lib/files/wordReader";
import { parseExcel } from "@/lib/files/excelReader";
import { parsePpt } from "@/lib/files/pptReader";
import { ParsedDocument } from "@/lib/files/types";

export const maxDuration = 60; // 処理時間が長くなる可能性を考慮

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "file が必要です" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileName = file.name.toLowerCase();

    let parsed: ParsedDocument;

    if (fileName.endsWith(".pdf")) {
      parsed = await parsePdf(buffer, fileName);
    } else if (fileName.endsWith(".docx")) {
      parsed = await parseWord(buffer, fileName);
    } else if (fileName.endsWith(".xlsx")) {
      parsed = await parseExcel(buffer, fileName);
    } else if (fileName.endsWith(".pptx")) {
      parsed = await parsePpt(buffer, fileName);
    } else {
      return NextResponse.json(
        { error: "対応していないファイル形式です" },
        { status: 400 }
      );
    }

    return NextResponse.json(parsed);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "ファイル解析中にエラーが発生しました" },
      { status: 500 }
    );
  }
}