export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }

  let userMessage;
  let history = [];
  let stream = false;

  try {
    const data = JSON.parse(body || "{}");
    userMessage = data.message;
    stream = !!data.stream;
    if (Array.isArray(data.history)) {
      history = data.history
        .filter(
          (m) =>
            m &&
            typeof m.role === "string" &&
            typeof m.content === "string"
        )
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

  if (stream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

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
            model: "deepseek-reasoner",
            messages,
            stream: true,
            max_output_tokens: 8192,
            temperature: 0.2,
            top_p: 0.95,
          }),
        }
      );

      if (!dsRes.ok || !dsRes.body) {
        const text = await dsRes.text().catch(() => "");
        const detail = text || `HTTP ${dsRes.status}`;
        res.write(
          "data: " +
            JSON.stringify({ type: "error", message: String(detail) }) +
            "\n\n"
        );
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      const reader = dsRes.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop();

        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith("data:")) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr || dataStr === "[DONE]") continue;

          let payload;
          try {
            payload = JSON.parse(dataStr);
          } catch {
            continue;
          }

          const delta = payload.choices && payload.choices[0] && payload.choices[0].delta
            ? payload.choices[0].delta
            : {};

          if (delta.reasoning_content) {
            res.write(
              "data: " +
                JSON.stringify({
                  type: "reasoning",
                  delta: delta.reasoning_content,
                }) +
                "\n\n"
            );
          }

          if (delta.content) {
            res.write(
              "data: " +
                JSON.stringify({
                  type: "final",
                  delta: delta.content,
                }) +
                "\n\n"
            );
          }
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err) {
      res.write(
        "data: " +
          JSON.stringify({ type: "error", message: String(err) }) +
          "\n\n"
      );
      res.write("data: [DONE]\n\n");
      res.end();
    }

    return;
  }

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
          model: "deepseek-reasoner",
          messages,
          stream: false,
          max_output_tokens: 8192,
          temperature: 0.2,
          top_p: 0.95,
        }),
      }
    );

    const json = await dsRes.json().catch(() => null);

    if (!dsRes.ok || (json && json.error)) {
      res.statusCode = dsRes.status || 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "DeepSeek API error",
          detail: json || null,
        })
      );
      return;
    }

    const choice = json && Array.isArray(json.choices) && json.choices[0]
      ? json.choices[0]
      : {};
    const msg = choice.message || {};

    const reply = msg.content || "（DeepSeek 没有返回内容）";
    const reasoning = msg.reasoning_content || null;

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        reply,
        reasoning,
        usage: json.usage || null,
      })
    );
  } catch (err) {
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
