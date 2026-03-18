/**
 * Vercel serverless proxy for the Hydromancer API.
 * Keeps the API key server-side and avoids CORS issues in the browser.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.HYDROMANCER_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'Hydromancer API key not configured' })
  }

  try {
    const upstream = await fetch('https://api.hydromancer.xyz/info', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(req.body),
    })

    const text = await upstream.text()
    res
      .status(upstream.status)
      .setHeader('Content-Type', 'application/json')
      .send(text)
  } catch (err) {
    res.status(502).json({ error: 'Upstream request failed', detail: String(err) })
  }
}
