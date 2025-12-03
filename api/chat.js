export const config = {
  runtime: "edge",
};

export default async function handler(req) {
  const { message, history = [] } = await req.json();

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return new Response("Missing API key", { status: 500 });
  }

  const messages = [
    {
      role: "system",
      content:
        "You are DeepSeek-V3.2-Speciale. Always reply in the user's language. You may output reasoning.",
    },
    ...history,
    { role: "user", content: message },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const response = await fetch(
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
            }),
          }
        );

        if (!response.ok || !response.body) {
          send({ error: "DeepSeek API error" });
          controller.close();
          return;
        }

        const reader = response.body.getReader();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += new TextDecoder().decode(value);

          const parts = buffer.split("\n");
          buffer = parts.pop();

          for (const line of parts) {
            if (!line.startsWith("data:")) continue;

            const payload = line.replace("data:", "").trim();
            if (payload === "[DONE]") {
              controller.close();
              return;
            }

            try {
              const json = JSON.parse(payload);

              const delta = json.choices?.[0]?.delta;
              if (!delta) continue;

              if (delta.reasoning_content) {
                send({
                  type: "reasoning",
                  text: delta.reasoning_content,
                });
              }

              if (delta.content) {
                send({
                  type: "final",
                  text: delta.content,
                });
              }
            } catch (e) {
              continue;
            }
          }
        }

        controller.close();
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: err.message })}\n\n`
          )
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
