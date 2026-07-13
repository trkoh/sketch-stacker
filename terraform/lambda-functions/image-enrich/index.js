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
 * 実バイトのマジックナンバーから画像形式を判定する。
 * 既存画像には拡張子が .png でも中身が JPEG 等のものが混ざっており、Bedrock は
 * 申告した format と実体の不一致を ValidationException で弾く(= 埋め込み/タグ両方失敗)。
 * よって拡張子ではなく実バイトで判定し、正しい format を Bedrock に渡す。
 * Nova(埋め込み/Lite) は png/jpeg/gif/webp を受け付ける。判定不能は png にフォールバック。
 * @param {Buffer} buf 画像バイト列
 * @returns {'png'|'jpeg'|'gif'|'webp'} 画像形式
 */
function detectImageFormat(buf) {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 3 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return 'png';
}

/**
 * Nova マルチモーダル埋め込みで画像をベクトル化する(検索インデックス用)。
 * @param {string} b64 base64エンコード済み画像
 * @returns {Promise<number[]>} 埋め込みベクトル
 */
async function embedImage(b64, format) {
  const body = {
    schemaVersion: 'nova-multimodal-embed-v1',
    taskType: 'SINGLE_EMBEDDING',
    singleEmbeddingParams: {
      embeddingPurpose: 'GENERIC_INDEX', // インデックス作成用(検索クエリ側は IMAGE_RETRIEVAL を使う)
      embeddingDimension: Number(process.env.EMBEDDING_DIMENSION || '1024'),
      image: {
        format, // 実バイトから判定した形式(png/jpeg/gif/webp)。拡張子は当てにしない。
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
 * Bedrock のマルチモーダルLLMで画像から日本語タグを生成する。
 * ※ wip-uploader にはユーザーの描いた全ジャンルの絵が入りうるため、
 *   画風・題材・構図などをプロンプトで限定しない(中立)。検索しやすい語を自由に拾わせる。
 *
 * モデルにより InvokeModel の body/応答形式が異なるため TAG_MODEL_ID の接頭辞で分岐:
 *  - amazon.nova-*  : Nova messages-v1 形式(用途フォーム不要・現状の既定)
 *  - それ以外(Claude): Anthropic Messages 形式(要 Anthropic 用途フォーム提出)
 * 検証(2026-06, us-east-1 実機): Claude 3 Haiku は Legacy 化で呼べず、Claude 4.5系は
 * アカウントへの Anthropic 用途フォーム提出が必須。Nova Lite は提出不要で即動作するため既定に採用。
 * @param {string} b64 base64エンコード済み画像
 * @returns {Promise<string[]>} 日本語タグ配列(最大 MAX_TAGS 件)
 */
async function generateTags(b64, format) {
  const modelId = process.env.TAG_MODEL_ID;
  // 検索用途(「山並みを含む絵を探す」)に効くよう、具体的な被写体・モチーフを最優先させ、
  // 検索の役に立たない汎用語・印象語を明示的に禁止する。
  const prompt = 'この画像は描かれた絵(スケッチ/イラスト/絵画)です。後から日本語で検索して見つけるためのタグを付けてください。\n'
    + '優先順位:\n'
    + '1. 描かれている具体的な被写体・モチーフを漏れなく(例: 山並み, 湖, 桟橋, 街並み, 人物, 猫, 木, 橋, 船, 空, 雲)\n'
    + '2. 場面・場所・時間帯が分かる場合(例: 海辺, 室内, 夜景, 夕焼け, 雪景色)\n'
    + '3. 画材・技法がはっきり分かる場合のみ(例: 水彩, 鉛筆デッサン, デジタル)\n'
    + 'ルール:\n'
    + '- 汎用語(絵, イラスト, アート, 作品, スケッチ)と印象語(綺麗, 素敵, 幻想的)は禁止\n'
    + '- 色や雰囲気の語は特に特徴的な場合だけ最大1個\n'
    + '- 各タグは短い日本語の名詞。確信が持てるものだけ\n'
    + `- 最大${MAX_TAGS}個\n`
    + '出力はJSON配列のみ(例: ["山並み","湖","夕焼け","水彩"])。説明文は不要。';

  const isNova = modelId.startsWith('amazon.nova');
  const body = isNova
    ? {
        schemaVersion: 'messages-v1',
        messages: [
          {
            role: 'user',
            content: [
              { image: { format, source: { bytes: b64 } } },
              { text: prompt },
            ],
          },
        ],
        inferenceConfig: { maxTokens: 256 },
      }
    : {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 256,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: `image/${format}`, data: b64 } },
              { type: 'text', text: prompt },
            ],
          },
        ],
      };
  const res = await bedrock.send(new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  }));
  const parsed = JSON.parse(Buffer.from(res.body).toString('utf-8'));
  // Nova: output.message.content[].text / Claude: content[].text
  const blocks = isNova
    ? ((parsed.output && parsed.output.message && parsed.output.message.content) || [])
    : (parsed.content || []);
  const text = blocks.filter((b) => typeof b.text === 'string').map((b) => b.text).join('');
  // モデルがコードフェンスや前後文を付けても拾えるよう、最初のJSON配列を抽出する。
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let tags;
  try {
    tags = JSON.parse(match[0]);
  } catch (e) {
    return [];
  }
  // モデルは同じ語を重複して返すことがある。autoTags は DynamoDB の String Set(SS) に格納するが
  // SS は重複を許さず、重複があると UpdateItem 全体が ValidationException で失敗する(埋め込みも巻き添えで落ちる)。
  // よってここで重複を除去してから返す。
  const cleaned = (Array.isArray(tags) ? tags : [])
    .filter((t) => typeof t === 'string' && t.trim().length > 0)
    .map((t) => t.trim());
  return [...new Set(cleaned)].slice(0, MAX_TAGS);
}

/**
 * 1枚の画像を処理してメタデータを更新する。upload非同期invoke / バックフィル共通のエントリ。
 * イベント形は { imageId: "<timestamp>.png" } を想定。
 * U-P2: { imageId, kind: "photo" } の場合はリファレンス写真モード —
 * 写真バケット/写真テーブルを対象に「埋め込みのみ」生成する（タグは写真には不要。
 * 埋め込みは絵↔写真の類似サジェスト用で、公開射影には一切出ない）。
 */
exports.handler = async (event) => {
  const imageId = event && event.imageId;
  if (!imageId || typeof imageId !== 'string') {
    console.error('imageId missing in event:', JSON.stringify(event));
    return { ok: false, error: 'imageId required' };
  }
  const isPhoto = event.kind === 'photo';
  const bucket = isPhoto ? process.env.PHOTO_BUCKET : process.env.IMAGE_BUCKET;
  const table = isPhoto ? process.env.PHOTO_TABLE : process.env.METADATA_TABLE;
  const keyAttr = isPhoto ? 'photoId' : 'imageId';

  const bytes = await getImageBytes(bucket, imageId);
  const b64 = bytes.toString('base64');
  // 拡張子が .png でも中身が JPEG 等のことがあるので実バイトで形式判定して Bedrock に渡す。
  const format = detectImageFormat(bytes);

  // 埋め込みとタグは独立なので並列化(片方失敗でも他方は活かす)。写真はタグ不要のためスキップ。
  const [embedResult, tagResult] = await Promise.allSettled([
    embedImage(b64, format),
    isPhoto ? Promise.resolve([]) : generateTags(b64, format),
  ]);

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
    TableName: table,
    Key: { [keyAttr]: { S: imageId } },
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
