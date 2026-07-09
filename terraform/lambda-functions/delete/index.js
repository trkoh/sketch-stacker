const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({ region: process.env.AWS_DEFAULT_REGION });

// 管理画面（GitHub Pages）からのブラウザ削除に応えるCORSヘッダ
const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

exports.handler = async (event) => {
  const rawKey = event.pathParameters && event.pathParameters.key;
  const key = rawKey ? decodeURIComponent(rawKey) : '';

  // 安全策: ルート直下の対応画像形式のみ削除可。viewer/images.json やフォルダは対象外
  // 対応拡張子は upload(#46) と揃える: png/jpg/jpeg/gif/webp
  if (!key || key.includes('/') || !/\.(png|jpe?g|gif|webp)$/i.test(key)) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid image key' }),
    };
  }

  try {
    // バケットはバージョニング有効なので、DeleteObjectは削除マーカーを作る論理削除（一定期間は復旧可能）
    await s3Client.send(new DeleteObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: key,
    }));

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleted: key }),
    };
  } catch (error) {
    console.error('Error deleting object:', error);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'An error occurred while deleting the image.' }),
    };
  }
};
