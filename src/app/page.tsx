"use client";

import {
  useState,
  useRef,
  ChangeEvent,
  KeyboardEvent,
  DragEvent,
} from "react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type QaPair = {
  question: string;
  answer: string;
};

type EmailMeta = {
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
};

export default function HomePage() {
  const [businessType, setBusinessType] = useState("決算1次チェック");
  const [mode, setMode] = useState("review");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [emailMeta, setEmailMeta] = useState<EmailMeta | null>(null);

  const templates = [
    "決算の全体プロセスを整理して",
    "税効果会計の主要論点を整理して",
    "このメールへの返信案を作って（問い合わせ対応）",
  ];

  // ---------- ファイル選択 ----------
  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploadedFiles((prev) => [...prev, ...files]);
    e.target.value = "";
  }

  // ---------- ドラッグ＆ドロップ ----------
  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);

    const newFiles: File[] = [];

    if (e.dataTransfer.items) {
      for (const item of Array.from(e.dataTransfer.items)) {
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f) newFiles.push(f);
        }
      }
    } else {
      for (const f of Array.from(e.dataTransfer.files)) {
        newFiles.push(f);
      }
    }

    if (newFiles.length === 0) return;
    setUploadedFiles((prev) => [...prev, ...newFiles]);
  }

  // ---------- チャット送信 ----------
  async function handleSend() {
    if (!input.trim()) return;
    setIsLoading(true);

    const currentInput = input;
    setMessages((prev) => [...prev, { role: "user", content: currentInput }]);
    setInput("");

    try {
      const form = new FormData();
      form.append("message", currentInput);
      form.append("businessType", businessType);
      form.append("mode", mode);

      uploadedFiles.forEach((f) => form.append("file", f));

      const res = await fetch("/api/chat", {
        method: "POST",
        body: form,
      });

      const data = await res.json().catch(() => ({} as any));

      const reply =
        data.reply ??
        data.answer ??
        data.content ??
        "(応答なし または 解析に失敗しました)";

      setEmailMeta(data.emailMeta ?? null);

      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "ネットワークエラーが発生しました。" },
      ]);
    } finally {
      setIsLoading(false);
      setUploadedFiles([]); // 送信後に添付クリア
    }
  }

  // ---------- Enter キー送信 ----------
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ---------- Q&A ペア（Excel / PPT 用） ----------
  const buildQaPairs = (): QaPair[] => {
    const result: QaPair[] = [];
    let lastQ: string | null = null;

    for (const m of messages) {
      if (m.role === "user") {
        lastQ = m.content;
      } else if (m.role === "assistant") {
        result.push({
          question: lastQ ?? "",
          answer: m.content,
        });
        lastQ = null;
      }
    }
    return result;
  };

  // ---------- Word 出力 ----------
  const escapeHtml = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const exportWord = () => {
    const assistantMessages = messages.filter((m) => m.role === "assistant");
    if (assistantMessages.length === 0) return;

    const content = assistantMessages
      .map((m, idx) => `【回答${idx + 1}】\n${m.content}`)
      .join("\n\n------------------------------\n\n");

    const html = `
      <html>
      <head><meta charset="utf-8" /></head>
      <body>
      <pre style="font-family: Meiryo; white-space: pre-wrap;">
${escapeHtml(content)}
      </pre></body></html>
    `;

    const blob = new Blob([html], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kessan-ai-answer.doc";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---------- Excel 出力 ----------
  const exportExcel = async () => {
    const qaPairs = buildQaPairs();
    if (qaPairs.length === 0) return;

    const ExcelJS = (await import("exceljs")).default;

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("AI回答");

    ws.columns = [
      { header: "No", key: "no", width: 6 },
      { header: "業務カテゴリ", key: "businessType", width: 20 },
      { header: "質問", key: "question", width: 40 },
      { header: "回答", key: "answer", width: 80 },
    ];

    qaPairs.forEach((qa, idx) => {
      ws.addRow({
        no: idx + 1,
        businessType,
        question: qa.question,
        answer: qa.answer,
      });
    });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "kessan-ai-answer.xlsx";
    a.click();
  };

  // ---------- PPT 出力 ----------
  const exportPpt = async () => {
    const qaPairs = buildQaPairs();
    if (qaPairs.length === 0) return;

    const PptxGenJS = (await import("pptxgenjs")).default;
    const pptx = new PptxGenJS();

    pptx.addSlide().addText("決算サポートAI 出力", {
      x: 0.5,
      y: 1,
      fontSize: 28,
      bold: true,
    });

    qaPairs.forEach((qa, idx) => {
      const slide = pptx.addSlide();
      slide.addText(`Q${idx + 1}: ${qa.question}`, {
        x: 0.5,
        y: 0.5,
        fontSize: 18,
        bold: true,
      });
      slide.addText(qa.answer, {
        x: 0.5,
        y: 1.4,
        fontSize: 14,
        w: 9,
        h: 4.5,
      });
    });

    await pptx.writeFile({ fileName: "kessan-ai-answer.pptx" });
  };

  // ---------- Outlook 用 EML 出力 ----------
  const exportEmail = () => {
    const assistantMessages = messages.filter((m) => m.role === "assistant");
    if (assistantMessages.length === 0) return;

    // 直近の AI 返信をそのまま本文として利用
    const body = assistantMessages[assistantMessages.length - 1].content.trim();

    // 件名 = Re: 元メールの件名
    const originalSubject = emailMeta?.subject ?? "お問い合わせの件";
    const subject = `Re: ${originalSubject}`;

    // ファイル名 = 件名（禁止文字だけ置換）
    const fileName = subject.replace(/[\\\/:*?"<>|]/g, "_");

    // 宛先 = 元メールの発信元（From）
    const toAddress = emailMeta?.from ?? "unknown@example.com";

    // CC は元メールの CC をそのまま転記（なければ空）
    const ccAddress = emailMeta?.cc ?? "";

    // 自分のアドレス（必要に応じて変更）
    const sender = "your.name@example.com";

    const headers = [
      `From: ${sender}`,
      `To: ${toAddress}`,
      ccAddress ? `Cc: ${ccAddress}` : "Cc: ",
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset="utf-8"',
      "",
    ];

    const eml = headers.join("\r\n") + body;

    const blob = new Blob([eml], { type: "message/rfc822" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fileName}.eml`;
    a.click();
  };

  // ---------- UI ----------
  return (
    <main className="h-screen w-screen bg-white text-black overflow-hidden">
      <div className="flex h-full w-full gap-4 p-4 box-border overflow-hidden">
        {/* 左ペイン */}
        <aside className="flex h-full w-72 flex-col rounded-2xl border border-gray-300 bg-gray-100 p-4 text-sm overflow-y-auto">
          <h1 className="mb-4 text-base font-semibold">業務カテゴリ</h1>
          <div className="mb-6 space-y-2">
            {[
              "決算締め処理",
              "税効果会計",
              "開示資料作成",
              "問い合わせ対応",
            ].map((t) => (
              <button
                key={t}
                onClick={() => setBusinessType(t)}
                className={`w-full rounded-md px-3 py-2 text-left border ${
                  businessType === t
                    ? "bg-blue-600 text-white border-blue-500"
                    : "bg-white text-black border-gray-300 hover:bg-gray-200"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <h2 className="mb-2 text-base font-semibold">テンプレート質問</h2>
          <div className="mb-6 space-y-2">
            {templates.map((tmp, i) => (
              <button
                key={i}
                onClick={() => setInput(tmp)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-left hover:bg-gray-200"
              >
                {tmp}
              </button>
            ))}
          </div>

          <h2 className="mb-2 text-base font-semibold">モード</h2>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="mb-6 w-full rounded-md border border-gray-300 bg-white px-3 py-2"
          >
            <option value="review">ドラフト</option>
            <option value="summary">レビュー</option>
            <option value="anomaly">要約</option>
          </select>

          <h2 className="mb-2 text-base font-semibold">ファイルアップロード</h2>
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center rounded-md border-2 border-dashed px-3 py-4 text-xs transition ${
              isDragging ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-white"
            }`}
          >
            <p className="mb-2 text-gray-700 text-center">
              ここにドラッグ＆ドロップ
              <br />
              または下のボタンで選択
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md border border-gray-300 bg-gray-100 px-3 py-1 text-xs hover:bg-gray-200"
            >
              ファイルを選択
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.xlsx,.xls,.pptx,.ppt,.eml,.msg,.txt"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {uploadedFiles.length > 0 && (
            <div className="mt-2 text-xs text-gray-700 space-y-1 border border-gray-300 rounded-md bg-white px-2 py-2">
              <p className="font-semibold mb-1">
                添付ファイル（{uploadedFiles.length}）
              </p>
              <ul className="list-disc pl-4 space-y-0.5">
                {uploadedFiles.map((f, idx) => (
                  <li key={idx}>{f.name}</li>
                ))}
              </ul>
            </div>
          )}
        </aside>

        {/* 右ペイン */}
        <section className="flex h-full flex-1 flex-col rounded-2xl border border-gray-300 bg-white min-h-0">
          {/* ヘッダー */}
          <header className="flex items-center justify-between border-b border-gray-300 px-6 py-3">
            <h2 className="text-lg font-semibold">決算サポートAI</h2>
            <span className="text-sm text-gray-500">{businessType}</span>
          </header>

          {/* メッセージ表示（スクロール） */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {messages.length === 0 && (
              <p className="text-sm text-gray-500">
                左で業務カテゴリとモード、必要に応じてファイルを指定し、質問を入力してください。
              </p>
            )}

            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex ${
                  m.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[80%] rounded-xl border px-4 py-2 whitespace-pre-wrap text-sm ${
                    m.role === "user"
                      ? "bg-blue-600 text-white border-blue-500"
                      : "bg-gray-100 text-black border-gray-300"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {isLoading && (
              <p className="text-sm text-gray-700">AIが考えています...</p>
            )}
          </div>

          {/* フッター */}
          <footer className="border-t border-gray-300 px-6 py-3">
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                onClick={exportWord}
                className="rounded-md border bg-gray-100 border-gray-300 px-3 py-2 text-xs hover:bg-gray-200"
              >
                Wordで出力
              </button>
              <button
                onClick={exportExcel}
                className="rounded-md border bg-gray-100 border-gray-300 px-3 py-2 text-xs hover:bg-gray-200"
              >
                Excelで出力
              </button>
              <button
                onClick={exportPpt}
                className="rounded-md border bg-gray-100 border-gray-300 px-3 py-2 text-xs hover:bg-gray-200"
              >
                PPTで出力
              </button>
              <button
                onClick={exportEmail}
                className="rounded-md border bg-gray-100 border-gray-300 px-3 py-2 text-xs hover:bg-gray-200"
              >
                Outlook用(.eml)
              </button>
            </div>

            <div className="flex gap-2">
              <textarea
                className="flex-1 resize-none rounded-xl border border-gray-300 bg-white p-3 text-sm outline-none focus:border-blue-500"
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="質問を入力してください（Enterで送信、Shift+Enterで改行）..."
              />
              <button
                onClick={handleSend}
                disabled={isLoading}
                className="h-[60px] w-24 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                送信
              </button>
            </div>
          </footer>
        </section>
      </div>
    </main>
  );
}
