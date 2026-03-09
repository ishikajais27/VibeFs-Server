// ─── In-memory rate limiter (10 requests per IP per day) ─────────────────────
const ipHits = new Map()

function checkRateLimit(ip) {
  const today = new Date().toDateString()
  const key = `${ip}-${today}`
  const hits = ipHits.get(key) || 0
  if (hits >= 10) return false
  ipHits.set(key, hits + 1)
  return true
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limit check
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress
  if (!checkRateLimit(ip)) {
    return res
      .status(429)
      .json({ error: 'Daily limit of 10 images reached. Try again tomorrow.' })
  }

  const { imageBase64, mediaType } = req.body

  if (!imageBase64 || !mediaType) {
    return res.status(400).json({ error: 'Missing imageBase64 or mediaType' })
  }

  const prompt = `You are a file system parser. The user has given you a screenshot or photo of a project folder/file structure (like a VS Code explorer tree, a diagram, or handwritten notes).

Your job is to extract that structure and return it as a STRICT JSON object.

Rules:
- Return ONLY valid JSON. No markdown, no explanation, no code fences.
- Use this exact schema:
  {
    "folderName": { "type": "folder", "children": { ... } },
    "fileName.ext": { "type": "file", "content": "" }
  }
- Files should have empty "content": ""
- Folders must have "type": "folder" and a "children" object.
- Reproduce the structure exactly as shown in the image.
- Return ONLY the JSON object, nothing else.`

  try {
    const groqResponse = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          max_tokens: 4096,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: { url: `data:${mediaType};base64,${imageBase64}` },
                },
                {
                  type: 'text',
                  text: prompt,
                },
              ],
            },
          ],
        }),
      },
    )

    if (!groqResponse.ok) {
      const err = await groqResponse.text()
      return res.status(500).json({ error: `Groq error: ${err}` })
    }

    const data = await groqResponse.json()
    const text = data.choices?.[0]?.message?.content?.trim() ?? ''

    return res.status(200).json({ result: text })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
