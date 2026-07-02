#!/usr/bin/env node
// バケットに存在するのに DynamoDB メタデータレコードが無い画像(=孤立画像)に、基本レコードを作る。
// 背景: 本アプリは PNG 前提(upload は PNG のみ受理・S3トリガも .png のみ)のため、過去に入った
//   JPG/JPEG 等はメタデータDBに登録されず、タグ・検索の対象外だった。ここで基本レコードを作れば、
//   後続の scripts/backfill-enrich.mjs が拾って enrich(タグ+埋め込み)してくれる。
//   ※ enrich は #39 で実バイトから形式判定するよう修正済み = JPEG でも埋め込み/タグが付く。
//
// このスクリプト自体は upload Lambda と同じ基本レコード({imageId, uploadedAt, visibility=private})を
// 作るだけ。タグ/埋め込みは作らない(それは enrich の責務)。べき等(既存レコードは上書きしない)。
//
// 事前準備(初回のみ): cd scripts && npm install
// 使い方(リポジトリ root から):
//   aws sso login --profile dev
//   AWS_PROFILE=dev REGION=ap-northeast-1 node scripts/register-orphan-images.mjs --dry-run  # 対象を見るだけ
//   AWS_PROFILE=dev REGION=ap-northeast-1 node scripts/register-orphan-images.mjs            # 実登録
// この後 scripts/backfill-enrich.mjs を回すと孤立画像も enrich される。
//
// 環境変数で上書き可: REGION / METADATA_TABLE / IMAGE_BUCKET
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { DynamoDBClient, ScanCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';

const REGION = process.env.REGION || 'ap-northeast-1';
const TABLE = process.env.METADATA_TABLE || 'WIPUploader-ImageMetadata';
const BUCKET = process.env.IMAGE_BUCKET || 'wip-uploader-strage';
const DRY_RUN = process.argv.slice(2).includes('--dry-run');

const s3 = new S3Client({ region: REGION });
const ddb = new DynamoDBClient({ region: REGION });

const IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i;

/** バケット内の画像キー一覧(viewer/ 運用ファイルは除外)。 */
async function listBucketImages() {
  const keys = [];
  let token;
  do {
    const res = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token }));
    for (const o of res.Contents || []) {
      if (o.Key.startsWith('viewer/')) continue;
      if (IMAGE_RE.test(o.Key)) keys.push(o.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** 既存の imageId 集合(強整合スキャンで取りこぼし防止)。 */
async function listExistingIds() {
  const ids = new Set();
  let lastKey;
  do {
    const res = await ddb.send(new ScanCommand({
      TableName: TABLE, ProjectionExpression: 'imageId', ExclusiveStartKey: lastKey, ConsistentRead: true,
    }));
    for (const it of res.Items || []) ids.add(it.imageId.S);
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return ids;
}

/** ファイル名先頭の数字をアップロード時刻(ミリ秒)として取り出す。取れなければ null。 */
function uploadedAtFromKey(key) {
  const m = key.match(/(\d{10,13})/);
  return m ? Number(m[1]) : null;
}

async function main() {
  const [images, existing] = await Promise.all([listBucketImages(), listExistingIds()]);
  const orphans = images.filter((k) => !existing.has(k));
  console.log(`バケット画像 ${images.length} / DB登録済 ${existing.size} / 孤立(未登録) ${orphans.length}`);
  if (DRY_RUN) {
    console.log('--dry-run: 登録は行わない。対象先頭20件:');
    orphans.slice(0, 20).forEach((k) => console.log('  ' + k));
    return;
  }

  let created = 0, skipped = 0;
  for (const key of orphans) {
    const item = { imageId: { S: key }, visibility: { S: 'private' } };
    const ts = uploadedAtFromKey(key);
    if (ts != null) item.uploadedAt = { N: String(ts) };
    try {
      // 念のため条件付き(既存があれば作らない)。べき等。
      await ddb.send(new PutItemCommand({
        TableName: TABLE, Item: item, ConditionExpression: 'attribute_not_exists(imageId)',
      }));
      created += 1;
      console.log(`[${created + skipped}/${orphans.length}] registered ${key}`);
    } catch (e) {
      if (e.name === 'ConditionalCheckFailedException') { skipped += 1; continue; }
      throw e;
    }
  }
  console.log(`完了: 登録 ${created} / 既存スキップ ${skipped}`);
  console.log('次: scripts/backfill-enrich.mjs を回すとこれらが enrich される。');
}

main().catch((e) => { console.error(e); process.exit(1); });
