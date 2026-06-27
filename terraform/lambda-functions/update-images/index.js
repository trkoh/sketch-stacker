const { S3Client, ListObjectsV2Command, PutObjectCommand } = require('@aws-sdk/client-s3');
const { CloudFront } = require('@aws-sdk/client-cloudfront');
const { DynamoDBClient, ScanCommand } = require('@aws-sdk/client-dynamodb');

const s3Client = new S3Client({ region: process.env.AWS_DEFAULT_REGION });
const ddb = new DynamoDBClient({ region: process.env.AWS_DEFAULT_REGION });

exports.handler = async (event) => {
  const imageBucket = process.env.IMAGE_BUCKET;
  const fileName = process.env.IMAGES_JSON_FILENAME_PATH;

  try {
    // ページネーションで全オブジェクトを取得（ListObjectsV2の1000件上限対策）
    const fileNames = [];
    let continuationToken;
    do {
      const listObjectsResponse = await s3Client.send(new ListObjectsV2Command({
        Bucket: imageBucket,
        ContinuationToken: continuationToken,
      }));
      for (const object of listObjectsResponse.Contents || []) {
        fileNames.push(object.Key);
      }
      continuationToken = listObjectsResponse.IsTruncated
        ? listObjectsResponse.NextContinuationToken
        : undefined;
    } while (continuationToken);
    console.log(fileNames);

    const jsonData = JSON.stringify(fileNames, null, 2);
    console.log(jsonData);

    const putObjectCommand = new PutObjectCommand({
      Bucket: imageBucket,
      Key: fileName,
      Body: jsonData,
      ContentType: 'application/json',
    });

    await s3Client.send(putObjectCommand);
    console.log("/"+fileName)

    // U1: DynamoDB から公開メタデータを射影して metadata.json を生成。
    // 公開フラグ付き(visibility=public)のメモだけを出し、非公開メモはCDNに出さない。
    const metaItems = [];
    let lastKey;
    do {
      const scan = await ddb.send(new ScanCommand({
        TableName: process.env.METADATA_TABLE,
        ExclusiveStartKey: lastKey,
      }));
      for (const it of scan.Items || []) metaItems.push(it);
      lastKey = scan.LastEvaluatedKey;
    } while (lastKey);

    const metaPath = process.env.METADATA_JSON_PATH || 'viewer/metadata.json';
    const publicMeta = metaItems.map((it) => {
      const visibility = (it.visibility && it.visibility.S) || 'private';
      return {
        imageId: it.imageId && it.imageId.S,
        uploadedAt: it.uploadedAt && it.uploadedAt.N ? Number(it.uploadedAt.N) : null,
        autoTags: (it.autoTags && it.autoTags.SS) || [],
        memo: visibility === 'public' && it.memo ? it.memo.S : null,
      };
    });
    await s3Client.send(new PutObjectCommand({
      Bucket: imageBucket,
      Key: metaPath,
      Body: JSON.stringify(publicMeta),
      ContentType: 'application/json',
    }));
    console.log("/" + metaPath);

    const client = new CloudFront();
    await client.createInvalidation({
      DistributionId: process.env.DISTRIBUTION_ID,
      InvalidationBatch: {
        CallerReference: new Date().toISOString(),
        Paths: {
          Quantity: 2,
          Items: ["/" + fileName, "/" + metaPath]
        }
      }
    });
    return {
      statusCode: 200,
      body: 'images.json saved successfully!',
    };
  } catch (error) {
    console.error('Error processing S3 event', error);
    return {
      statusCode: 500,
      body: 'Error processing S3 event',
    };
  }
};