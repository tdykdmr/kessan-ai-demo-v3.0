"use client";

import { useState, ChangeEvent, KeyboardEvent } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export default function HomePage() {
  const [businessType, setBusinessType] = useState("決算1次チェック");
  const [mode, setMode] = useState("review");
  const [fileText, setFileText] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const templates = [
    "決算1次チェックの全体プロセスを整理して",
    "固定資産の実務フローとAI活用ポイントを説明して",
    "税効果会計の主要論点を整理して",
  ];

  // ========= ファイルアップロード =========
  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/files/ingest", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error("ファイル解析APIエラー");
      }

      const data = await res.json();
      setFileText(data.text || "");
    } catch (err) {
      console.error(err);
      alert("ファイル解析に失敗しました");
    }
  }

  // ========= チャット送信 =========
  async function handleSend() {
    if (!input.trim()) return;
    setIsLoading(true);

    const userMessage: ChatMessage = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    const currentInput = input;
    setInput("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: currentInput,
          businessType,
          mode,
          contextText: fileText,
        }),
      });

      const data = await res.json().catch(() => ({} as any));

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content:
          data.reply ??
          data.answer ??
          data.content ??
          "(応答なし)",
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "ネットワークエラーが発生しました。" },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ========= Word / Excel 出力 =========
  const escapeHtml = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
          <pre style="font-family: Meiryo, sans-serif; white-space: pre-wrap;">
${escapeHtml(content)}
          </pre>
        </body>
      </html>
    `;

    const blob = new Blob([html], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kessan-ai-answer.doc";
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportExcel = () => {
    const assistantMessages = messages.filter((m) => m.role === "assistant");
    if (assistantMessages.length === 0) return;

    const header = ["No", "BusinessType", "Content"];
    const rows = assistantMessages.map((m, idx) => {
      const no = String(idx + 1);
      const bt = businessType;
      const content = m.content.replace(/"/g, '""').replace(/\r?\n/g, "\\n");
      return [`"${no}"`, `"${bt}"`, `"${content}"`].join(",");
    });

    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kessan-ai-answer.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ========= UI レイアウト =========
  return (
    <main className="h-screen w-screen bg-white text-black">
      <div className="flex h-full w-full gap-4 p-4 box-border">

        {/* 左ペイン */}
        <aside className="flex h-full w-72 flex-col rounded-2xl border border-gray-300 bg-gray-100 p-4 text-sm">
          
          <h1 className="mb-4 text-base font-semibold">業務カテゴリ</h1>

          <div className="mb-6 space-y-2">
            {["決算1次チェック", "固定資産", "税効果会計", "開示レビュー"].map(
              (t) => (
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
              )
            )}
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
            <option value="review">レビュー</option>
            <option value="summary">要約</option>
            <option value="anomaly">異常値っぽい箇所の指摘</option>
          </select>

          <h2 className="mb-2 text-base font-semibold">ファイルアップロード</h2>
          <input
            type="file"
            accept=".pdf,.docx,.xlsx,.pptx"
            onChange={handleFileChange}
            className="w-full text-xs"
          />

          {fileText && (
            <p className="mt-2 line-clamp-3 text-xs text-gray-600">
              解析テキスト（冒頭）: {fileText.slice(0, 120)}...
            </p>
          )}
        </aside>

        {/* 右ペイン */}
        <section className="flex h-full flex-1 flex-col rounded-2xl border border-gray-300 bg-white">

          {/* ヘッダー */}
          <header className="flex items-center justify-between border-b border-gray-300 px-6 py-3">
            <h2 className="text-lg font-semibold">決算AIアシスタント</h2>
            <span className="text-sm text-gray-500">{businessType}</span>
          </header>

          {/* メッセージ表示 */}
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
            {messages.length === 0 && (
              <p className="text-sm text-gray-500">
                左側で業務カテゴリとモードを選び、必要に応じてファイルを指定し、質問を入力してください。
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
            <div className="mb-3 flex gap-2">
              <button
                onClick={exportWord}
                className="rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-xs hover:bg-gray-200"
              >
                Wordで出力
              </button>
              <button
                onClick={exportExcel}
                className="rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-xs hover:bg-gray-200"
              >
                Excelで出力
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
                className="h-[60px] w-24 rounded-xl bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
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
