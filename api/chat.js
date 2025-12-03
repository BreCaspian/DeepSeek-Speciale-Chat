// api/chat.js

res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

// 处理 OPTIONS 请求
if (req.method === "OPTIONS") {
  res.statusCode = 204;
  res.end();
  return;
}

export default async function handler(req, res) {
  // 只允许 POST
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  // 读取请求体
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }

  let userMessage;
  let history = [];

  try {
    const data = JSON.parse(body || "{}");
    userMessage = data.message;

    // 可选：前端传来的 history（你以后想做多轮对话可以用）
    if (Array.isArray(data.history)) {
      history = data.history
        .filter(
          (m) =>
            m &&
            typeof m.role === "string" &&
            typeof m.content === "string"
        )
        .slice(-20); // 只保留最近 20 条，防止太长
    }
  } catch (e) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return;
  }

  if (!userMessage) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Missing 'message' field" }));
    return;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Server misconfigured: no API key" }));
    return;
  }

  // 组装 DeepSeek messages
  const messages = [
    {
      role: "system",
      content:
        "You are DeepSeek-V3.2-Speciale, a helpful and rigorous assistant. " +
        "Always answer in the same language as the user. " +
        "When appropriate, you may use step-by-step reasoning internally, " +
        "but keep the final explanation clear and concise.",
    },
    ...history,
    { role: "user", content: userMessage },
  ];

  try {
    const dsRes = await fetch(
      "https://api.deepseek.com/v3.2_speciale_expires_on_20251215/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "deepseek-reasoner",     // 推理模型
          messages,
          stream: false,
          max_output_tokens: 1024,
          // 如将来需要额外控制，可以在这里加参数
          // return_reasoning: true,
        }),
      }
    );

    const json = await dsRes.json();

    if (!dsRes.ok || json.error) {
      console.error("DeepSeek API error:", json);
      res.statusCode = dsRes.status || 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "DeepSeek API error",
          detail: json,
        })
      );
      return;
    }

    const choice = json.choices?.[0] || {};
    const msg = choice.message || {};

    const reply =
      msg.content || "（DeepSeek 没有返回内容）";

    // ⭐ 重点：拿到推理过程（可能为 undefined，没有就返回 null）
    const reasoning = msg.reasoning_content || null;

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        reply,
        reasoning,        // 前端可选择展示 / 折叠
        usage: json.usage || null,
      })
    );
  } catch (err) {
    console.error("Server error calling DeepSeek:", err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "Server error",
        detail: String(err),
      })
    );
  }
}
