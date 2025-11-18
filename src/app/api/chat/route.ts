// src/app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import { callChatCompletion } from "@/lib/llm/client";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, businessType, mode, contextText } = body as {
      message: string;
      businessType?: string;
      mode?: string;
      contextText?: string;
    };

    if (!message) {
      return NextResponse.json(
        { error: "message が必要です" },
        { status: 400 }
      );
    }

    const systemPrompt = `
あなたは上場企業の決算業務に精通したプロの会計士かつAIアシスタントです。
利用者は決算実務担当者またはコンサルタントです。
日本基準・IFRS・税務・監査実務を踏まえ、わかりやすく、ただし専門的な観点も含めて回答してください。
業務タイプ: ${businessType ?? "未指定"}
モード: ${mode ?? "general"}
`;

    const contentForAI = `
【ユーザーからのメッセージ】
${message}

${contextText ? `【関連ドキュメントの内容（要約）】\n${contextText}` : ""}
`;

    const reply = await callChatCompletion([
      { role: "system", content: systemPrompt },
      { role: "user", content: contentForAI },
    ]);

    return NextResponse.json({ reply });
  } catch (err: any) {
    console.error("CHAT API ERROR (server):", err);
    return NextResponse.json(
      {
        error: "内部エラーが発生しました",
        detail: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}
