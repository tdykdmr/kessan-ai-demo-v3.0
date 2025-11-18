const endpoint = process.env.AZURE_OPENAI_ENDPOINT!;
const apiKey = process.env.AZURE_OPENAI_API_KEY!;
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT!;

if (!endpoint || !apiKey || !deployment) {
  throw new Error("Azure OpenAI の環境変数が不足しています");
}

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export async function callChatCompletion(messages: ChatMessage[]) {
  const url = `${endpoint}/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      model: deployment,        // gpt-5-mini-kessan
      messages,                 // [{ role, content }]
      // temperature: 0.2,  ← 削除！
      max_completion_tokens: 4096,
    }),
  });

  const text = await res.text();

  if (!res.ok) {
    console.error("Azure OpenAI ERROR:", res.status, text);
    throw new Error(`Azure OpenAI API error: ${res.status} ${text}`);
  }

  const data = JSON.parse(text);
  const output = data.choices?.[0]?.message?.content ?? "";
  return output as string;
}
