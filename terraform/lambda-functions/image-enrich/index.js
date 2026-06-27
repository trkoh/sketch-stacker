// U2: アップロード画像から「日本語モチーフタグ(Claude Haiku)」と「検索用ベクトル(Nova埋め込み)」を
// 生成し DynamoDB に格納する。upload Lambda から非同期invoke(InvocationType=Event)され、
// バックフィルスクリプトからも同じ関数を再利用する。
//
// 設計(ADR-002 / U2): 画像は既に公開CDN上にあるため Bedrock へ送ることは新たな機密漏れではない。
// 失敗してもアップロード本体は成功扱い(後でバックフィル可能)。タグ/埋め込みは公開射影に使われる。
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

const s3 = new S3Client({ region: process.env.AWS_DEFAULT_REGION });
const ddb = new DynamoDBClient({ region: process.env.AWS_DEFAULT_REGION });
// Bedrock のモデル提供リージョンは S3/DynamoDB と別な場合があるため独立指定。
const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION || process.env.AWS_DEFAULT_REGION });

const MAX_TAGS = 10;

/**
 * S3 上の PNG をバイト列で取得する。
 * @param {string} bucket バケット名
 * @param {string} key オブジェクトキー(=imageId)
 * @returns {Promise<Buffer>} 画像バイト列
 */
async function getImageBytes(bucket, key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * Nova マルチモーダル埋め込みで画像をベクトル化する(検索インデックス用)。
 * @param {string} b64 base64エンコード済み画像
 * @returns {Promise<number[]>} 埋め込みベクトル
 */
async function embedImage(b64) {
  const body = {
    schemaVersion: 'nova-multimodal-embed-v1',
    taskType: 'SINGLE_EMBEDDING',
    singleEmbeddingParams: {
      embeddingPurpose: 'GENERIC_INDEX', // インデックス作成用(検索クエリ側は IMAGE_RETRIEVAL を使う)
      embeddingDimension: Number(process.env.EMBEDDING_DIMENSION || '1024'),
      image: {
        format: 'png',
        detailLevel: 'STANDARD_IMAGE',
        source: { bytes: b64 }, // 25MB(base64後)以内のインライン。本アプリのupload上限は10MB。
      },
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

/**
 * Claude Haiku(Bedrock)で画像から日本語モチーフタグを生成する。
 * @param {string} b64 base64エンコード済み画像
 * @returns {Promise<string[]>} 日本語タグ配列(最大 MAX_TAGS 件)
 */
async function generateTags(b64) {
  const prompt = `この絵(スケッチ/水彩等のplein air作品)を見て、モチーフ・被写体・構図を表す日本語タグを${MAX_TAGS}個以内で挙げてください。`
    + '「山並み」「夕焼け」「街並み」のような短い名詞。固有名詞や推測の地名は避ける。'
    + 'JSON配列だけを出力(例: ["山並み","川","木立"])。説明文は不要。';
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  };
  const res = await bedrock.send(new InvokeModelCommand({
    modelId: process.env.TAG_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  }));
  const parsed = JSON.parse(Buffer.from(res.body).toString('utf-8'));
  const text = (parsed.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  // モデルがコードフェンスや前後文を付けても拾えるよう、最初のJSON配列を抽出する。
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let tags;
  try {
    tags = JSON.parse(match[0]);
  } catch (e) {
    return [];
  }
  return (Array.isArray(tags) ? tags : [])
    .filter((t) => typeof t === 'string' && t.trim().length > 0)
    .map((t) => t.trim())
    .slice(0, MAX_TAGS);
}

/**
 * 1枚の画像を処理してメタデータを更新する。upload非同期invoke / バックフィル共通のエントリ。
 * イベント形は { imageId: "<timestamp>.png" } を想定。
 */
exports.handler = async (event) => {
  const imageId = event && event.imageId;
  if (!imageId || typeof imageId !== 'string') {
    console.error('imageId missing in event:', JSON.stringify(event));
    return { ok: false, error: 'imageId required' };
  }

  const bytes = await getImageBytes(process.env.IMAGE_BUCKET, imageId);
  const b64 = bytes.toString('base64');

  // 埋め込みとタグは独立なので並列化(片方失敗でも他方は活かす)。
  const [embedResult, tagResult] = await Promise.allSettled([embedImage(b64), generateTags(b64)]);

  const exprNames = {};
  const exprValues = {};
  const setClauses = [];

  if (embedResult.status === 'fulfilled') {
    // ベクトルは要素数が多いため JSON 文字列で1属性に格納(検索射影時に U3 がパース)。
    exprNames['#e'] = 'embedding';
    exprValues[':e'] = { S: JSON.stringify(embedResult.value) };
    setClauses.push('#e = :e');
  } else {
    console.error('embedImage failed:', embedResult.reason);
  }

  if (tagResult.status === 'fulfilled' && tagResult.value.length > 0) {
    exprNames['#t'] = 'autoTags';
    exprValues[':t'] = { SS: tagResult.value };
    setClauses.push('#t = :t');
  } else if (tagResult.status === 'rejected') {
    console.error('generateTags failed:', tagResult.reason);
  }

  if (setClauses.length === 0) {
    return { ok: false, imageId, error: 'both embedding and tags failed' };
  }

  // 監査用に処理時刻も記録。
  exprNames['#ea'] = 'enrichedAt';
  exprValues[':ea'] = { N: String(event.now || 0) };
  setClauses.push('#ea = :ea');

  await ddb.send(new UpdateItemCommand({
    TableName: process.env.METADATA_TABLE,
    Key: { imageId: { S: imageId } },
    UpdateExpression: 'SET ' + setClauses.join(', '),
    ExpressionAttributeNames: exprNames,
    ExpressionAttributeValues: exprValues,
  }));

  return {
    ok: true,
    imageId,
    embedded: embedResult.status === 'fulfilled',
    tagged: tagResult.status === 'fulfilled' && tagResult.value.length > 0,
  };
};
