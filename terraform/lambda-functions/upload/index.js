const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const s3Client = new S3Client({ region: process.env.AWS_DEFAULT_REGION });
const ddb = new DynamoDBClient({ region: process.env.AWS_DEFAULT_REGION });
const lambda = new LambdaClient({ region: process.env.AWS_DEFAULT_REGION });

// アップロード可能な画像形式をマジックバイトで判定する。
// #20 の「中身が本当に画像か」を担保しつつ、PNG に加え iPhone 由来の JPEG など
// 下流(enrich #39・ギャラリー表示)が既に対応する形式も受理する。
// 未知/非画像は null（拒否）。ext と MIME を返し、正しい拡張子・Content-Type で保存する。
function detectImageType(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return { ext: 'gif', mime: 'image/gif' };
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

// HEIC/HEIF（iPhone 標準フォーマット）は Bedrock もブラウザも表示不可のため受理しない。
// 「PNGではない」という不親切なエラーではなく具体的な対処を返すために別途判定する。
function isHeic(buf) {
  if (buf.length < 12 || buf.toString('ascii', 4, 8) !== 'ftyp') return false;
  const brand = buf.toString('ascii', 8, 12);
  return ['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'].includes(brand);
}

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body);

    // #20: 画像データの存在チェック
    if (!body || typeof body.image !== 'string') {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing image data' })
      };
    }

    const imageData = Buffer.from(body.image, 'base64');

    // #20: サイズ上限（10MB）
    const MAX_BYTES = 10 * 1024 * 1024;
    if (imageData.length === 0 || imageData.length > MAX_BYTES) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid image size' })
      };
    }

    // #20 の意図(中身が本当に画像か)を維持しつつ、対応形式を PNG/JPEG/GIF/WebP に拡張。
    // マジックバイトで判定し、未知形式は拒否。HEIC は具体的な対処を促す。
    const imageType = detectImageType(imageData);
    if (!imageType) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: isHeic(imageData)
            ? 'HEIC/HEIF は非対応です。iPhone の「設定 > カメラ > フォーマット」を「互換性優先」にする（JPEGで撮影）か、JPEG/PNG に変換してアップロードしてください。'
            : 'Unsupported image format. PNG / JPEG / GIF / WebP のみ対応しています。'
        })
      };
    }

    const key = `${Date.now()}.${imageType.ext}`;

    const command = new PutObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: key,
      Body: imageData,
      ContentType: imageType.mime,
      StorageClass: 'GLACIER_IR'
    });

    await s3Client.send(command);

    // U1: メタデータ基盤に基本レコードを作成（memo/tags/embedding は後続Unitで付与）。
    // 失敗してもアップロードは成功扱い（後でバックフィル可能・後方互換を優先）。
    try {
      await ddb.send(new PutItemCommand({
        TableName: process.env.METADATA_TABLE,
        Item: {
          imageId: { S: key },
          uploadedAt: { N: String(Date.now()) },
          visibility: { S: 'private' },
        },
      }));
    } catch (e) {
      console.error('metadata PutItem failed (upload succeeded):', e);
    }

    // U2: タグ+埋め込み生成を enrich Lambda に非同期委譲(InvocationType=Event)。
    // fire-and-forget。失敗してもアップロードは成功扱い(後でバックフィル可能)。
    // S3 ObjectCreated は update-images が既に同条件で使用しオーバーラップ不可のため、
    // ここから直接 async invoke する(承認済みA案の性質: 即返し/疎結合/障害隔離を維持)。
    if (process.env.ENRICH_FUNCTION_NAME) {
      try {
        await lambda.send(new InvokeCommand({
          FunctionName: process.env.ENRICH_FUNCTION_NAME,
          InvocationType: 'Event',
          Payload: Buffer.from(JSON.stringify({ imageId: key, now: Date.now() })),
        }));
      } catch (e) {
        console.error('enrich invoke failed (upload succeeded):', e);
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: `https://${process.env.CLOUDFRONT_DOMAIN}/${key}`
      })
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'An error occurred while processing your request.' })
    };
  }
};