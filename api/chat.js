import OpenAI from "openai";

export default async function handler(req, res) {
  const client = new OpenAI({
    baseURL: "https://api.deepseek.com/v3.2_speciale_expires_on_20251215",
    apiKey: process.env.DEEPSEEK_API_KEY, // 从 Vercel 环境变量读取
  });

  try {
    const userMessage = req.body.message;

    const reply = await client.chat.completions.create({
      model: "deepseek-reasoner",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: userMessage }
      ],
    });

    res.status(200).json({
      reply: reply.choices[0].message.content,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
