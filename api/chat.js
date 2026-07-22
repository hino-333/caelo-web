// 許可オリジン（本番・プレビュー・ローカル開発）
const ALLOWED_ORIGINS = ['https://caelo-web.vercel.app'];
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/caelo-web-[a-z0-9-]+\.vercel\.app$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];
function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return ALLOWED_ORIGIN_PATTERNS.some(re => re.test(origin));
}

const MAX_BODY_BYTES = 4096;
const MAX_TOKENS     = 500;
const FORCED_MODEL   = 'gpt-4o-mini';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Origin検証
  if (!isAllowedOrigin(req.headers.origin)) {
    return res.status(403).json({ error: 'Forbidden origin' });
  }

  // 入力サイズ検証
  const clientBody = req.body || {};
  if (JSON.stringify(clientBody).length > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Payload too large' });
  }

  // 最低限の形式チェック
  if (!Array.isArray(clientBody.messages) || clientBody.messages.length === 0) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  // モデル・最大トークンをサーバー側で強制上書き（コスト暴走防止）
  const safeBody = { ...clientBody, model: FORCED_MODEL, max_tokens: MAX_TOKENS };

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // APIキーはVercelの環境変数から取得（フロントには一切露出しない）
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(safeBody)
    });

    const data = await response.json();
    return res.status(response.status).json(data);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
