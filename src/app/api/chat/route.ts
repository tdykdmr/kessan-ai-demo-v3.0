// src/app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
export const runtime = "nodejs";

type EmailMeta = {
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
};

/* --------------------------------
 *  Responses API からテキスト抽出
 * -------------------------------- */
function extractAssistantTextFromResponse(data: any): string {
  if (!data) {
    return "応答テキストを取得できませんでした（レスポンスが空です）";
  }

  // 新 Responses API 形式: output[] 内の type === "message"
  if (Array.isArray(data.output)) {
    const messageItem = data.output.find((item: any) => item?.type === "message");

    if (messageItem && Array.isArray(messageItem.content)) {
      const texts = messageItem.content
        .filter(
          (part: any) =>
            part &&
            part.type === "output_text" &&
            typeof part.text === "string"
        )
        .map((part: any) => part.text);

      if (texts.length > 0) {
        return texts.join("\n");
      }
    }
  }

  // フォールバック: output_text 直下
  if (typeof data.output_text === "string") {
    return data.output_text;
  }

  // フォールバック: output.message.content[]
  if (data.output?.message?.content && Array.isArray(data.output.message.content)) {
    const texts = data.output.message.content
      .map((c: any) => c?.text?.value ?? c?.text ?? "")
      .filter((t: string) => !!t);
    if (texts.length > 0) {
      return texts.join("\n");
    }
  }

  // フォールバック: output[0].content[]
  if (Array.isArray(data.output) && data.output[0]?.content) {
    const contents = data.output[0].content;
    if (Array.isArray(contents)) {
      const texts = contents
        .map((c: any) => c?.text?.value ?? c?.text ?? "")
        .filter((t: string) => !!t);
      if (texts.length > 0) {
        return texts.join("\n");
      }
    }
  }

  // 旧 chat completions 互換
  if (data.choices?.[0]?.message?.content) {
    return data.choices[0].message.content;
  }

  return "";
}

/* --------------------------------
 *  Word（.docx）テキスト抽出
 * -------------------------------- */
async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value || "";
}

/* --------------------------------
 *  Excel（.xlsx / .xls）テキスト抽出
 * -------------------------------- */
async function extractTextFromXlsx(buffer: Buffer): Promise<string> {
  const xlsx = await import("xlsx");
  const wb = xlsx.read(buffer, { type: "buffer" });

  const parts: string[] = [];

  wb.SheetNames.forEach((sheetName: string) => {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return;

    const rows: any[][] = xlsx.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
    });

    parts.push(`【シート: ${sheetName}】`);
    for (const row of rows) {
      const cells = (row || [])
        .map((v) => (v === null || v === undefined ? "" : String(v)))
        .join("\t");
      parts.push(cells);
    }
  });

  return parts.join("\n");
}

/* --------------------------------
 *  PowerPoint（.pptx / .ppt）テキスト抽出
 * -------------------------------- */
async function extractTextFromPptx(buffer: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const { DOMParser } = await import("@xmldom/xmldom");

  const zip = await JSZip.loadAsync(buffer);
  const fileNames = Object.keys(zip.files).filter((name) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(name)
  );

  const parts: string[] = [];
  fileNames.sort();

  for (const name of fileNames) {
    const xmlStr = await zip.files[name].async("text");
    const doc = new DOMParser().parseFromString(xmlStr, "text/xml");
    const textNodes = doc.getElementsByTagName("a:t");

    const texts: string[] = [];
    for (let i = 0; i < textNodes.length; i++) {
      const node = textNodes.item(i);
      if (node && node.textContent) {
        texts.push(node.textContent);
      }
    }

    parts.push(`【スライド: ${name}】`);
    parts.push(texts.join("\n"));
  }

  return parts.join("\n");
}

/* --------------------------------
 *  .eml ヘッダパース
 * -------------------------------- */
function parseEmailHeaders(headerText: string): EmailMeta {
  const lines = headerText.split(/\r?\n/);
  const meta: EmailMeta = {};
  let currentHeader = "";
  let currentValue = "";

  const flush = () => {
    if (!currentHeader) return;
    const name = currentHeader.toLowerCase();
    const value = currentValue.trim();
    if (name === "from") meta.from = value;
    if (name === "to") meta.to = value;
    if (name === "cc") meta.cc = value;
    if (name === "subject") meta.subject = value;
  };

  for (const line of lines) {
    if (/^\s/.test(line)) {
      // 折返し行
      currentValue += " " + line.trim();
    } else {
      if (currentHeader) flush();
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      currentHeader = line.slice(0, idx).trim();
      currentValue = line.slice(idx + 1).trim();
    }
  }
  flush();

  return meta;
}

export async function POST(req: NextRequest) {
  try {
    console.log("=== /api/chat HIT ===");

    const form = await req.formData();
    const message = form.get("message") as string | null;
    const businessType = (form.get("businessType") as string | null) ?? "未指定";
    const mode = (form.get("mode") as string | null) ?? "general";

    const files = form.getAll("file").filter((v) => v instanceof File) as File[];

    console.log("[CHAT] formData:", {
      hasMessage: !!message,
      businessType,
      mode,
      fileCount: files.length,
      fileNames: files.map((f) => f.name),
      fileTypes: files.map((f) => f.type),
    });

    if (!message) {
      return NextResponse.json(
        { error: "message が必要です" },
        { status: 400 }
      );
    }

    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION;
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;

    console.log("[CHAT] env check:", {
      hasEndpoint: !!endpoint,
      hasApiKey: !!apiKey,
      hasApiVersion: !!apiVersion,
      hasDeployment: !!deployment,
    });

    if (!endpoint || !apiKey || !apiVersion || !deployment) {
      return NextResponse.json(
        {
          error: "Azure OpenAI の環境変数が不足しています",
          detail: {
            AZURE_OPENAI_ENDPOINT: !!endpoint,
            AZURE_OPENAI_API_KEY: !!apiKey,
            AZURE_OPENAI_API_VERSION: !!apiVersion,
            AZURE_OPENAI_DEPLOYMENT: !!deployment,
          },
        },
        { status: 500 }
      );
    }

    // ===== 1. 問い合わせモード判定 (.eml / .msg があれば強制 ON) =====
    const hasEmailFile = files.some((f) => {
      const n = f.name.toLowerCase();
      return n.endsWith(".eml") || n.endsWith(".msg");
    });

    // ===== 2. systemPrompt =====
    let systemPrompt: string;

    if (hasEmailFile) {
      // ← ここが「問い合わせ対応」専用
      systemPrompt = `
あなたは日本語のビジネスメール返信を作成するアシスタントです。

【最重要ルール】
・返信メール本文だけを1通だけ作成すること。
・件名案、複数パターン、番号付きの案（1) 2) 等）は出さないこと。
・「件名:」「本文案:」「回答案:」などのラベルも出さないこと。
・そのまま Outlook から送信できる自然なビジネス日本語で書くこと。
・署名ブロックはダミー（会社名・部署名・氏名・連絡先は仮）で付けること。

【返信メールの構成】
1. 冒頭挨拶
2. 相手の要件の簡潔な要約
3. 質問・依頼への回答／提案（不足情報があれば丁寧に依頼）
4. クロージング
5. 署名（ダミーで可）

上記の構成を満たしつつ、「返信メール本文」だけを出力してください。
`.trim();
    } else {
      // 通常の決算・会計アシスタント用
      systemPrompt = `
あなたは上場企業の決算業務に精通したプロの会計士かつAIアシスタントです。
利用者は決算実務担当者またはコンサルタントです。
日本基準・IFRS・税務・監査実務を踏まえ、専門的かつ分かりやすく回答してください。
業務タイプ: ${businessType}
モード: ${mode}
アップロードされたファイル（PDF・Word・Excel・PPT）の内容も踏まえて、決算レビューや会計処理の背景を丁寧に説明してください。
`.trim();
    }

    // ===== 3. ユーザーコンテンツ =====
    const userContent: any[] = [];
    userContent.push({
      type: "input_text",
      text: message,
    });

    // 添付メールのメタ情報（最後の1通分）
    let lastEmailMeta: EmailMeta | null = null;

    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const lowerName = file.name.toLowerCase();
      const mime = file.type || "application/octet-stream";

      // --- PDF ---
      if (mime === "application/pdf" || lowerName.endsWith(".pdf")) {
        const base64 = buffer.toString("base64");
        const fileData = `data:application/pdf;base64,${base64}`;

        userContent.push({
          type: "input_file",
          file_data: fileData,
          filename: file.name,
        });

        console.log("[CHAT] attached PDF as input_file:", file.name);
        continue;
      }

      // --- Word (.docx) ---
      if (
        mime ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        lowerName.endsWith(".docx")
      ) {
        const docxText = await extractTextFromDocx(buffer);
        console.log("[CHAT] extracted docx text length:", docxText.length);

        userContent.push({
          type: "input_text",
          text:
            `以下はアップロードされた Word ファイル「${file.name}」の本文です。` +
            `決算一次チェック・会計処理の背景として、この内容も踏まえて回答してください。\n\n` +
            docxText,
        });
        continue;
      }

      // --- Excel (.xlsx / .xls) ---
      if (
        mime ===
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        mime === "application/vnd.ms-excel" ||
        lowerName.endsWith(".xlsx") ||
        lowerName.endsWith(".xls")
      ) {
        const xlsxText = await extractTextFromXlsx(buffer);
        console.log("[CHAT] extracted xlsx text length:", xlsxText.length);

        userContent.push({
          type: "input_text",
          text:
            `以下はアップロードされた Excel ファイル「${file.name}」の内容（シート／セル）をテキスト化したものです。` +
            `勘定残高・分析用のデータとして、この内容も踏まえて回答してください。\n\n` +
            xlsxText,
        });
        continue;
      }

      // --- PowerPoint (.pptx / .ppt) ---
      if (
        mime ===
          "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
        mime === "application/vnd.ms-powerpoint" ||
        lowerName.endsWith(".pptx") ||
        lowerName.endsWith(".ppt")
      ) {
        const pptxText = await extractTextFromPptx(buffer);
        console.log("[CHAT] extracted pptx text length:", pptxText.length);

        userContent.push({
          type: "input_text",
          text:
            `以下はアップロードされた PowerPoint ファイル「${file.name}」のスライド上のテキストです。` +
            `経営説明資料・決算説明会資料として、この内容も踏まえて回答してください。\n\n` +
            pptxText,
        });
        continue;
      }

      // --- メールファイル (.eml テキスト形式) ---
      if (lowerName.endsWith(".eml")) {
        const text = buffer.toString("utf-8");
        const [rawHeaders, rawBody] = text.split(/\r?\n\r?\n/, 2);
        const bodyText = rawBody ?? text;

        if (rawHeaders) {
          const meta = parseEmailHeaders(rawHeaders);
          lastEmailMeta = meta;
          console.log("[CHAT] parsed .eml meta:", meta);
        }

        console.log("[CHAT] extracted .eml body length:", bodyText.length);

        userContent.push({
          type: "input_text",
          text:
            `以下はアップロードされたメールファイル「${file.name}」の本文です。` +
            `問い合わせ内容として読み取り、適切な返信メール本文を1通作成してください。\n\n` +
            bodyText,
        });
        continue;
      }

      // --- Outlook .msg (バイナリ) ---
      if (lowerName.endsWith(".msg")) {
        try {
          const msgreaderMod: any = await import("msgreader");
          const MSGReader =
            msgreaderMod.default || msgreaderMod.MSGReader || msgreaderMod;

          // msgreader は Buffer / Uint8Array を受け取れる
          const reader = new MSGReader(buffer);
          const msgData: any = reader.getFileData();

          const fromEmail: string | undefined =
            msgData.senderEmail || msgData.senderEmailAddress || undefined;
          const fromName: string | undefined = msgData.senderName || undefined;
          const subject: string | undefined = msgData.subject || undefined;
          const bodyText: string =
            msgData.body ||
            msgData.bodyText ||
            (typeof msgData.bodyHtml === "string"
              ? msgData.bodyHtml.replace(/<[^>]+>/g, "")
              : "") ||
            "";

          lastEmailMeta = {
            from: fromEmail || fromName,
            subject,
          };

          console.log("[CHAT] parsed .msg meta:", lastEmailMeta);
          console.log("[CHAT] extracted .msg body length:", bodyText.length);

          userContent.push({
            type: "input_text",
            text:
              `以下はアップロードされた Outlook メールファイル（.msg）「${file.name}」の本文です。` +
              `問い合わせ内容として読み取り、適切な返信メール本文を1通作成してください。\n\n` +
              bodyText,
          });
        } catch (e) {
          console.error("[CHAT] .msg parse error:", e);
          // 失敗した場合はテキストとして無理やり読み込む（最悪パターン）
          const fallbackText = buffer.toString("utf-8");
          userContent.push({
            type: "input_text",
            text:
              `以下はアップロードされたメールファイル「${file.name}」の内容です（一部文字化けしている可能性があります）。` +
              `問い合わせ内容として読み取り、適切な返信メール本文を1通作成してください。\n\n` +
              fallbackText,
          });
        }
        continue;
      }

      // --- テキストファイル (.txt など) ---
      if (mime.startsWith("text/") || lowerName.endsWith(".txt")) {
        const text = buffer.toString("utf-8");
        console.log("[CHAT] extracted text file length:", text.length);

        userContent.push({
          type: "input_text",
          text:
            `以下はアップロードされたテキストファイル「${file.name}」の内容です。` +
            `問い合わせや補足情報として読み取り、必要に応じて回答に反映してください。\n\n` +
            text,
        });
        continue;
      }

      // --- その他形式 ---
      console.warn("[CHAT] unsupported file type (ignored for now):", {
        name: file.name,
        mime,
      });
    }

    // ===== 4. Azure Responses API 呼び出し =====
    const payload = {
      model: deployment,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    };

    const url = `${endpoint}/openai/responses?api-version=${apiVersion}`;
    console.log("[CHAT] Calling Azure Responses:", url);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });

    const raw = await res.text();
    console.log("[CHAT] Azure status:", res.status);
    console.log("[CHAT] Azure raw body (first 500 chars):", raw.slice(0, 500));

    if (!res.ok) {
      return NextResponse.json(
        {
          error: "Azure OpenAI 呼び出しでエラーが発生しました",
          detail: raw,
        },
        { status: 500 }
      );
    }

    let data: any;
    try {
      data = JSON.parse(raw);
    } catch (e: any) {
      console.error("[CHAT] JSON parse error:", e?.message ?? String(e));
      return NextResponse.json(
        {
          error: "Azure 応答の JSON パースに失敗しました",
          detail: raw,
        },
        { status: 500 }
      );
    }

    let reply = extractAssistantTextFromResponse(data);

    if (!reply || !reply.trim()) {
      reply = `【応答テキストを取得できませんでした。生レスポンス（抜粋）】
${JSON.stringify(data, null, 2).slice(0, 2000)}
`;
    }

    // emailMeta は .msg/.eml があったときだけ埋まる想定
    return NextResponse.json({ reply, emailMeta: lastEmailMeta });
  } catch (err: any) {
    console.error("CHAT ROUTE ERROR:", err);
    return NextResponse.json(
      {
        error: "内部エラーが発生しました",
        detail: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}
