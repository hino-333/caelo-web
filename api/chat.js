// 許可オリジン（本番・プレビュー・ローカル開発）
const ALLOWED_ORIGINS = ['https://caelo-web.vercel.app', 'https://caelo-wayhome.vercel.app'];
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/caelo-web-[a-z0-9-]+\.vercel\.app$/,
  /^https:\/\/caelo-wayhome-[a-z0-9-]+\.vercel\.app$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];
function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return ALLOWED_ORIGIN_PATTERNS.some(re => re.test(origin));
}

const MAX_BODY_BYTES = 4096;
const MAX_AVOID      = 20;
const CANDIDATES     = 4;

// 新しいモデルから順に試す（使えなかったときは前のモデルで選曲を続ける）
const MODELS = [
  { model: 'gpt-6-luna', reasoning_effort: 'low', max_completion_tokens: 2000 },
  { model: 'gpt-4o-mini', temperature: 1.1, max_tokens: 900 },
];

const GENRE_HINTS = [
  '90年代J-POPの心に染みる名曲', '2000年代の懐かしいヒット曲', '2010年代の隠れた名曲', '2020年代の隠れた名曲',
  '有名アーティストのファンに愛される名曲', '夜に聴きたいシティポップ',
  '日本の女性シンガーソングライターの定番曲', '日本の男性シンガーソングライターのエモい曲',
  'アコースティックな邦楽', '日本のオルタナティヴ・ロック（邦ロック）の定番',
  'エモいJ-Rock', '昭和歌謡・平成レトロな名曲', 'チル系の邦楽（深夜に合う）',
  '最近の邦楽（少し落ち着いた曲）', '日本のネオソウル/R&B',
  'ピアノが美しい邦楽', 'ボカロP出身アーティストのエモーショナルな楽曲',
  'アニメ・映画主題歌の心に残る名曲(邦楽)'
];

const pick = list => list[Math.floor(Math.random() * list.length)];
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function systemPrompt(avoid) {
  const avoidLine = avoid.length
    ? `\n7. 次の曲はこの人に最近届けたばかりなので、候補に入れないでください：${avoid.map(s => `${s.artist}「${s.title}」`).join('、')}`
    : '';
  return `あなたはユーザーに「帰る場所」を提供する、音楽への愛が深いDJです。
【絶対ルール】
1. 候補を${CANDIDATES}曲選んでください。${CANDIDATES}曲はすべて別のアーティストにし、同じ気分の人にいつも同じ曲を返すような、真っ先に思いつく定番ばかりにならないようにしてください。
2. 知名度のバランスが命です。Mr.Childrenの「口笛」のような【ある程度知名度はあるが、ベタすぎない絶妙なライン】を狙って選曲してください。
3. 今回は【${pick(GENRE_HINTS)}】のジャンルや雰囲気を隠し味として意識してください。
4. ユーザーはその曲をApple Musicで検索しますので、実在する曲だけを選び、正確な曲名とアーティスト名を提供してください。
5. 楽曲は9割以上の確率で日本語の歌詞の邦楽から選んでください。
6. コメントは曲ごとに、故郷の情景を交え、地元の旧友からの手紙のように温かく80文字程度で。${avoidLine}
【重要】手紙の中に、ユーザーが選んだ気分（嬉しい、疲れたなど）の言葉をそのまま使ったり、「〇〇な日は〜」と反復することは絶対に行わないでください。自然な話し言葉の励ましに変換してください。
【超重要】アルバム名ではなく、必ず単一の「楽曲名（1曲）」を選曲してください。
必ず以下のJSONフォーマットのみで返答してください。 {"songs": [{"artist": "アーティスト名", "title": "曲名", "comment": "手紙のような温かいコメント"}]}`;
}

async function ask(settings, messages) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // APIキーはVercelの環境変数から取得（フロントには一切露出しない）
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({ ...settings, messages, response_format: { type: 'json_object' } })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `OpenAI ${response.status}`);
  const songs = JSON.parse(data.choices[0].message.content).songs;
  if (!Array.isArray(songs)) throw new Error('No songs in response');
  return songs
    .map(s => ({ artist: text(s.artist, 100), title: text(s.title, 100), comment: text(s.comment, 300) }))
    .filter(s => s.artist && s.title && s.comment);
}

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

  // 指示文はサーバー側で組み立てる（気分・故郷・天気・最近の曲だけを受け取る）
  const mood = text(clientBody.mood, 100), pref = text(clientBody.pref, 20), weather = text(clientBody.weather, 40);
  if (!mood || !pref || !weather) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  const avoid = (Array.isArray(clientBody.avoid) ? clientBody.avoid : [])
    .slice(-MAX_AVOID)
    .map(s => ({ artist: text(s?.artist, 60), title: text(s?.title, 60) }))
    .filter(s => s.artist && s.title);

  const messages = [
    { role: 'system', content: systemPrompt(avoid) },
    { role: 'user', content: `私の気分は「${mood}」、故郷は「${pref}」、故郷の今の天気は「${weather}」です。私にぴったりな曲を選んでください。` }
  ];

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  let lastError;
  for (const settings of MODELS) {
    try {
      const songs = await ask(settings, messages);
      if (songs.length) return res.status(200).json({ songs, model: settings.model });
    } catch (error) {
      lastError = error;
      console.error(`${settings.model}: ${error.message}`);
    }
  }
  return res.status(502).json({ error: lastError ? lastError.message : 'No songs' });
}
