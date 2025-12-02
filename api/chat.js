// api/chat.js
export default async function handler(req, res) {
  // 只允许 POST
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  // 读取请求体（因为这里不是框架，要自己读）
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }

  let message;
  try {
    const data = JSON.parse(body);
    message = data.message;
  } catch (e) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return;
  }

  if (!message) {
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

  try {
    // 直接用 fetch 调 DeepSeek Speciale
    const dsRes = await fetch(
      "https://api.deepseek.com/v3.2_speciale_expires_on_20251215/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "deepseek-reasoner",
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: message },
          ],
          stream: false,
        }),
      }
    );

    const json = await dsRes.json();

    if (!dsRes.ok) {
      res.statusCode = dsRes.status;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "DeepSeek API error",
          detail: json,
        })
      );
      return;
    }

    const reply =
      json.choices?.[0]?.message?.content || "（DeepSeek 没有返回内容）";

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ reply }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Server error", detail: String(err) }));
  }
}
