// U4: 振り返りメモの取得/更新 API。オーナー限定（既存 Basic 認証 authorizer 再利用=ADR-003）。
//  - GET  /memos/{key} : 1画像の memo と visibility を返す（非公開メモも認証済みなので返す）。
//  - PUT  /memos/{key} : memo 本文と visibility(public|private) を保存。
// 保存後は update-images を非同期invoke して公開射影 metadata.json を更新する
// （metadata.json は visibility=public のメモだけを載せる。非公開メモは CDN に出ない=NFR-2）。
const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const ddb = new DynamoDBClient({ region: process.env.AWS_DEFAULT_REGION });
const lambda = new LambdaClient({ region: process.env.AWS_DEFAULT_REGION });

// 管理画面(GitHub Pages)からのブラウザ呼び出しに応える CORS ヘッダ。
const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

const MAX_MEMO_CHARS = 2000;

const respond = (statusCode, payload) => ({
  statusCode,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

exports.handler = async (event) => {
  const method = event.httpMethod;
  if (method === 'OPTIONS') return respond(200, {});

  const rawKey = event.pathParameters && event.pathParameters.key;
  const key = rawKey ? decodeURIComponent(rawKey) : '';
  // 安全策: ルート直下の対応画像形式のみ対象。viewer/配下やフォルダは対象外。
  // 対応拡張子は upload(#46) と揃える: png/jpg/jpeg/gif/webp
  if (!key || key.includes('/') || !/\.(png|jpe?g|gif|webp)$/i.test(key)) {
    return respond(400, { error: 'Invalid image key' });
  }

  try {
    if (method === 'GET') {
      const res = await ddb.send(new GetItemCommand({
        TableName: process.env.METADATA_TABLE,
        Key: { imageId: { S: key } },
        ProjectionExpression: 'imageId, memo, visibility',
      }));
      const it = res.Item || {};
      return respond(200, {
        imageId: key,
        memo: (it.memo && it.memo.S) || '',
        visibility: (it.visibility && it.visibility.S) || 'private',
      });
    }

    if (method === 'PUT') {
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
      // visibility は public|private のみ許可。不正値は private に倒す（デフォルト非公開=既決事項）。
      const visibility = parsed.visibility === 'public' ? 'public' : 'private';

      await ddb.send(new UpdateItemCommand({
        TableName: process.env.METADATA_TABLE,
        Key: { imageId: { S: key } },
        UpdateExpression: 'SET #m = :m, #v = :v',
        ExpressionAttributeNames: { '#m': 'memo', '#v': 'visibility' },
        ExpressionAttributeValues: { ':m': { S: memo }, ':v': { S: visibility } },
      }));

      // 公開射影 metadata.json を更新するため update-images を非同期invoke(fire-and-forget)。
      // 失敗してもメモ保存自体は成功扱い(次のアップロードや手動invokeでも再生成される)。
      if (process.env.UPDATE_IMAGES_FUNCTION) {
        try {
          await lambda.send(new InvokeCommand({
            FunctionName: process.env.UPDATE_IMAGES_FUNCTION,
            InvocationType: 'Event',
            Payload: Buffer.from(JSON.stringify({ reason: 'memo-updated', imageId: key })),
          }));
        } catch (e) {
          console.error('update-images invoke failed (memo は保存済み):', e);
        }
      }

      return respond(200, { imageId: key, memo, visibility });
    }

    return respond(405, { error: 'Method not allowed' });
  } catch (error) {
    console.error('memos handler error:', error);
    return respond(500, { error: 'Internal error' });
  }
};
