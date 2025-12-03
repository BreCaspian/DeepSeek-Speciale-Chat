// api/chat.js

// 这个 handler 既兼容旧的 { message } 请求
// 也支持新的 { message, history }，history 是完整对话历史
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

    // 允许前端传 { history: [{role, content}, ...] }
    if (Array.isArray(data.history)) {
      history = data.history
        .filter(
          (m) =>
            m &&
            typeof m.role === "string" &&
            typeof m.content === "string"
        )
        // 避免上下文太长，这里只保留最近 20 条对话（不含 system）
        .slice(-20);
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

  // 组装要发给 DeepSeek 的 messages：
  // system 提示 + 历史对话 + 当前用户消息
  const messages = [
    {
      role: "system",
      content:
        "You are DeepSeek-V3.2-Speciale, a helpful and rigorous assistant. " +
        "Always answer in the same language as the user. " +
        "Keep your reasoning internal; only output clear final answers.",
    },
    ...history,
    { role: "user", content: userMessage },
  ];

  try {
    // DeepSeek-V3.2-Speciale 的专用 base_url（你原来就是用的这个）
    const dsRes = await fetch(
      "https://api.deepseek.com/v3.2_speciale_expires_on_20251215/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "deepseek-reasoner", // Speciale 只支持推理模型
          messages,
          stream: false,
          // 可选：限制输出长度，避免一不小心特别长
          max_output_tokens: 1024,
        }),
      }
    );

    const json = await dsRes.json();

    // DeepSeek 可能在 body 里返回 { error: {...} }
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

    const choice = json.choices?.[0];

    // 最终展示的回答（只用 message.content，不展示 reasoning_content）
    const reply =
      choice?.message?.content || "（DeepSeek 没有返回内容）";

    // 如果你以后想用思维过程，可以从 choice.reasoning_content 里取

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        reply,
        // 可选：把 usage 带回去，方便你将来做 token 统计
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

