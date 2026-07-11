// U-P1: リファレンス写真 API（Phase 2 / ADR-006）。
// 写真は「完成した絵」と違い常に非公開: 専用の非公開バケット（CloudFront非接続）と
// 専用 DynamoDB テーブルに保存し、閲覧は期限付き presigned URL のみで行う。
//  - POST   /photos       : 写真アップロード（iOSショートカット/curl。upload用パスワードで可）
//  - GET    /photos       : 一覧＋presigned URL（管理パスワードのみ）
//  - PUT    /photos/{key} : 撮影メモの編集（管理パスワードのみ）
//  - DELETE /photos/{key} : 削除（管理パスワードのみ。バケットはバージョニング有効=復旧可能）
// 認可の出し分けは API Gateway の authorizer（authorizer/index.js）が行う。
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { DynamoDBClient, PutItemCommand, ScanCommand, UpdateItemCommand, DeleteItemCommand } = require('@aws-sdk/client-dynamodb');

const s3 = new S3Client({ region: process.env.AWS_DEFAULT_REGION });
const ddb = new DynamoDBClient({ region: process.env.AWS_DEFAULT_REGION });

const BUCKET = process.env.PHOTO_BUCKET;
const TABLE = process.env.PHOTO_TABLE;
const PRESIGN_TTL_SECONDS = 600; // 閲覧URLの寿命。管理UIの1セッション内で使い切る想定

const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

const MAX_MEMO_CHARS = 2000;

const respond = (statusCode, payload) => ({
  statusCode,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

// upload Lambda(#20/#46)と同じマジックバイト判定。拡張子・Content-Typeを実バイトから決める。
function detectImageType(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return { ext: 'gif', mime: 'image/gif' };
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

function isHeic(buf) {
  if (buf.length < 12 || buf.toString('ascii', 4, 8) !== 'ftyp') return false;
  const brand = buf.toString('ascii', 8, 12);
  return ['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'].includes(brand);
}

async function handleUpload(event) {
  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return respond(400, { error: 'Invalid JSON body' });
  }
  if (!body || typeof body.image !== 'string') {
    return respond(400, { error: 'Missing image data' });
  }

  const imageData = Buffer.from(body.image, 'base64');
  const MAX_BYTES = 10 * 1024 * 1024;
  if (imageData.length === 0 || imageData.length > MAX_BYTES) {
    return respond(400, { error: 'Invalid image size' });
  }

  const imageType = detectImageType(imageData);
  if (!imageType) {
    return respond(400, {
      error: isHeic(imageData)
        ? 'HEIC/HEIF は非対応です。ショートカット側で JPEG に変換してから送ってください。'
        : 'Unsupported image format. PNG / JPEG / GIF / WebP のみ対応しています。',
    });
  }

  const memo = typeof body.memo === 'string' ? body.memo.slice(0, MAX_MEMO_CHARS) : '';
  const now = Date.now();
  const key = `${now}.${imageType.ext}`;

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: imageData,
    ContentType: imageType.mime,
    // 写真は描くとき（管理UI閲覧）に即時取得したいので Glacier ではなく STANDARD。
    // 枚数規模的にコスト差は誤差（数GBで数十円/月）。
  }));

  const item = {
    photoId: { S: key },
    uploadedAt: { N: String(now) },
  };
  if (memo) item.memo = { S: memo };
  await ddb.send(new PutItemCommand({ TableName: TABLE, Item: item }));

  return respond(200, { photoId: key });
}

async function handleList() {
  const items = [];
  let lastKey;
  do {
    const res = await ddb.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: lastKey }));
    for (const it of res.Items || []) items.push(it);
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  // 新しい順に返し、各写真に閲覧用の presigned URL を付ける（署名はローカル計算なので軽い）。
  items.sort((a, b) => Number(b.uploadedAt && b.uploadedAt.N || 0) - Number(a.uploadedAt && a.uploadedAt.N || 0));
  const photos = await Promise.all(items.map(async (it) => ({
    photoId: it.photoId.S,
    uploadedAt: it.uploadedAt && it.uploadedAt.N ? Number(it.uploadedAt.N) : null,
    memo: (it.memo && it.memo.S) || '',
    url: await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET, Key: it.photoId.S }),
      { expiresIn: PRESIGN_TTL_SECONDS },
    ),
  })));

  return respond(200, { photos, expiresIn: PRESIGN_TTL_SECONDS });
}

async function handleMemoUpdate(key, event) {
  let parsed;
  try {
    parsed = event.body ? JSON.parse(event.body) : {};
  } catch (e) {
    return respond(400, { error: 'Invalid JSON body' });
  }
  const memo = typeof parsed.memo === 'string' ? parsed.memo : '';
  if (memo.length > MAX_MEMO_CHARS) {
    return respond(400, { error: `memo too long (max ${MAX_MEMO_CHARS} chars)` });
  }

  await ddb.send(new UpdateItemCommand({
    TableName: TABLE,
    Key: { photoId: { S: key } },
    UpdateExpression: 'SET #m = :m',
    ExpressionAttributeNames: { '#m': 'memo' },
    ExpressionAttributeValues: { ':m': { S: memo } },
  }));
  return respond(200, { photoId: key, memo });
}

async function handleDelete(key) {
  // バケットはバージョニング有効: DeleteObject は削除マーカー=論理削除（一定期間は復旧可能）。
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  await ddb.send(new DeleteItemCommand({ TableName: TABLE, Key: { photoId: { S: key } } }));
  return respond(200, { deleted: key });
}

exports.handler = async (event) => {
  const method = event.httpMethod;
  if (method === 'OPTIONS') return respond(200, {});

  const rawKey = event.pathParameters && event.pathParameters.key;
  const key = rawKey ? decodeURIComponent(rawKey) : '';

  try {
    if (!rawKey) {
      if (method === 'POST') return handleUpload(event);
      if (method === 'GET') return handleList();
      return respond(405, { error: 'Method not allowed' });
    }

    // キー付きルート（PUT/DELETE）。upload と同じ形式のフラットなキーのみ許可。
    if (!key || key.includes('/') || !/\.(png|jpe?g|gif|webp)$/i.test(key)) {
      return respond(400, { error: 'Invalid photo key' });
    }
    if (method === 'PUT') return handleMemoUpdate(key, event);
    if (method === 'DELETE') return handleDelete(key);
    return respond(405, { error: 'Method not allowed' });
  } catch (error) {
    console.error('photos handler error:', error);
    return respond(500, { error: 'Internal error' });
  }
};
