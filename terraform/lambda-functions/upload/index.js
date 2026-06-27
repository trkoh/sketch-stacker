const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const s3Client = new S3Client({ region: process.env.AWS_DEFAULT_REGION });
const ddb = new DynamoDBClient({ region: process.env.AWS_DEFAULT_REGION });

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

    // #20: PNGマジックバイト(89 50 4E 47 0D 0A 1A 0A)を検証し、中身がPNG以外の保存を拒否
    const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (imageData.length < 8 || !imageData.subarray(0, 8).equals(PNG_SIGNATURE)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Uploaded data is not a valid PNG image' })
      };
    }

    const key = `${Date.now()}.png`;

    const command = new PutObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: key,
      Body: imageData,
      ContentType: 'image/png',
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