/** Cerebras chat completions, called straight from the browser with the writer's own key. */

const API_URL = "https://api.cerebras.ai/v1/chat/completions"

export const DEFAULT_MODEL = "gpt-oss-120b"

/** Asks for one reply that matches `schema` and returns it parsed. */
export async function complete({ apiKey, model, system, user, schema }) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_completion_tokens: 6000,
      ...(model.startsWith("gpt-oss") ? { reasoning_effort: "low" } : {}),
      response_format: { type: "json_schema", json_schema: { name: "reply", strict: true, schema } },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  })

  if (!response.ok) {
    const error = new Error(await problemOf(response))
    error.status = response.status
    const seconds = Number(response.headers.get("retry-after"))
    if (seconds > 0) error.retryAfter = seconds * 1000
    throw error
  }
  const content = (await response.json()).choices?.[0]?.message?.content
  try {
    return JSON.parse(content)
  } catch {
    throw new Error("Cerebras sent a reply that could not be read")
  }
}

async function problemOf(response) {
  if (response.status === 401) return "Cerebras rejected the API key"
  if (response.status === 429) return "Cerebras rate limit reached, wait a moment"
  const detail = await response.json().then((body) => body.error?.message ?? body.message, () => "")
  return `Cerebras error ${response.status}${detail ? `: ${detail}` : ""}`
}
