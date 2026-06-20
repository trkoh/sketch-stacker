const { S3Client, ListObjectsV2Command, PutObjectCommand } = require('@aws-sdk/client-s3');
const { CloudFront } = require('@aws-sdk/client-cloudfront');

const s3Client = new S3Client({ region: process.env.AWS_DEFAULT_REGION });

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

    const client = new CloudFront();
    await client.createInvalidation({
      DistributionId: process.env.DISTRIBUTION_ID,
      InvalidationBatch: {
        CallerReference: new Date().toISOString(),
        Paths: {
          Quantity: 1,
          Items: ["/" + fileName]
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