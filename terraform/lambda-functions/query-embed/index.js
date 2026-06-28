// U3b: 意味検索のクエリ側エンドポイント。検索文字列を Nova テキスト埋め込みでベクトル化して返す。
// ブラウザから直接 Bedrock は叩けないため、この Lambda が唯一の Bedrock 接点になる。
// 返したベクトルとフロントが遅延ロードする viewer/embeddings.json(画像側ベクトル)を
// ブラウザ内でコサイン比較する(ADR-002)。エンドポイントは既存 authorizer で Basic 認証必須(ADR-005=A)。
//
// 設計の実機検証(2026-06-28 us-east-1): クエリは embeddingPurpose=IMAGE_RETRIEVAL、
// 画像側は GENERIC_INDEX。別 purpose だがコサインは意味的に分離する(関連 0.43 / 無関係 0.01)。
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

// Bedrock のモデル提供リージョンは API/Lambda 本体(東京)と別(us-east-1)なため独立指定。
const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION || process.env.AWS_DEFAULT_REGION });

// 管理画面(GitHub Pages)からのブラウザ呼び出しに応える CORS ヘッダ。
const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

// 1クエリの文字数上限(過大入力・コスト/レイテンシ暴走の防止)。
const MAX_QUERY_CHARS = 200;

const respond = (statusCode, payload) => ({
  statusCode,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

/**
 * 検索文字列を Nova マルチモーダル埋め込み(テキスト・検索クエリ用)でベクトル化する。
 * @param {string} text 検索クエリ
 * @returns {Promise<number[]>} 埋め込みベクトル(次元は EMBEDDING_DIMENSION)
 */
async function embedQuery(text) {
  const body = {
    schemaVersion: 'nova-multimodal-embed-v1',
    taskType: 'SINGLE_EMBEDDING',
    singleEmbeddingParams: {
      // 検索クエリ側は IMAGE_RETRIEVAL(画像を取り出す問い合わせ)。画像側インデックスは GENERIC_INDEX。
      embeddingPurpose: 'IMAGE_RETRIEVAL',
      embeddingDimension: Number(process.env.EMBEDDING_DIMENSION || '1024'),
      text: { truncationMode: 'END', value: text },
    },
  };
  const res = await bedrock.send(new InvokeModelCommand({
    modelId: process.env.EMBED_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  }));
  const parsed = JSON.parse(Buffer.from(res.body).toString('utf-8'));
  return parsed.embeddings[0].embedding;
}

exports.handler = async (event) => {
  // API Gateway プロキシ統合。本体は POST /search。OPTIONS は API 側 MOCK で処理される想定だが念のため許容。
  if (event.httpMethod === 'OPTIONS') {
    return respond(200, {});
  }

  let q;
  try {
    const parsed = event.body ? JSON.parse(event.body) : {};
    q = typeof parsed.q === 'string' ? parsed.q.trim() : '';
  } catch (e) {
    return respond(400, { error: 'Invalid JSON body' });
  }

  if (!q) {
    return respond(400, { error: 'q (search query) is required' });
  }
  if (q.length > MAX_QUERY_CHARS) {
    return respond(400, { error: `q too long (max ${MAX_QUERY_CHARS} chars)` });
  }

  try {
    const embedding = await embedQuery(q);
    return respond(200, {
      embedding,
      dim: embedding.length,
      model: process.env.EMBED_MODEL_ID,
    });
  } catch (error) {
    console.error('query-embed failed:', error);
    return respond(500, { error: 'Failed to embed query' });
  }
};
