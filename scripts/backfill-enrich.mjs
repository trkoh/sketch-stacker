#!/usr/bin/env node
// U2 バックフィル: 既存画像(実数 518枚・未処理 516枚)のタグ+埋め込みを一度だけ生成する。
// enrich Lambda を画像ごとに呼び出すだけなので、生成ロジックは本番と完全に同一。
// terraform apply と同じくオーナーがローカルで実行する(初回限りの一時費用: 埋め込み≈$0.5 / タグ≈$10)。
//
// 事前準備(初回のみ): このスクリプトは AWS SDK に依存する。scripts/ で依存を入れること。
//   cd scripts && npm install   (scripts/package.json。node_modules は scripts/ 配下に置かれ .gitignore 済み)
//
// 使い方(リポジトリ root から実行):
//   aws sso login --profile dev
//   AWS_PROFILE=dev node scripts/backfill-enrich.mjs --limit 5  # まず小さく試走(推奨)
//   AWS_PROFILE=dev node scripts/backfill-enrich.mjs            # 未処理(embedding無し)だけ
//   AWS_PROFILE=dev node scripts/backfill-enrich.mjs --all      # 全画像を再処理
//
// ⚠ 重要: このスクリプトは DDB を更新するだけ。フロントが読む公開射影 viewer/metadata.json は
//   update-images Lambda が作るので、バックフィル完了後に1回だけ手動invokeして再生成すること:
//   aws lambda invoke --function-name WIPUploaderUpdateImagesJsonFunction --payload '{}' \
//     --cli-binary-format raw-in-base64-out --profile dev --region ap-northeast-1 /tmp/upd.json
//   (DDB全スキャン→metadata.json/images.json再生成→CloudFront invalidate まで自動。費用ゼロ)
//   ※関数名は LIVE スタックの WIPUploader 接頭辞を厳守(別スタック ImageUploader* は触らない)。
//
// 環境変数で上書き可:
//   REGION(既定 ap-northeast-1) / METADATA_TABLE / ENRICH_FUNCTION / CONCURRENCY(既定 2)
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const REGION = process.env.REGION || 'ap-northeast-1';
const TABLE = process.env.METADATA_TABLE || 'WIPUploader-ImageMetadata';
const ENRICH_FUNCTION = process.env.ENRICH_FUNCTION || 'WIPUploader-ImageEnrichFunction';
const CONCURRENCY = Number(process.env.CONCURRENCY || '2');

const args = process.argv.slice(2);
const ALL = args.includes('--all');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;

const ddb = new DynamoDBClient({ region: REGION });
const lambda = new LambdaClient({ region: REGION });

/** メタデータテーブルを全件スキャンし、対象 imageId 一覧を返す。 */
async function listTargets() {
  const ids = [];
  let lastKey;
  do {
    const res = await ddb.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: lastKey }));
    for (const it of res.Items || []) {
      const hasEmbedding = !!(it.embedding && it.embedding.S);
      if (ALL || !hasEmbedding) ids.push(it.imageId.S);
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return ids;
}

/** enrich Lambda を同期invokeし結果を返す(失敗を観測したいので RequestResponse)。 */
async function enrich(imageId) {
  const res = await lambda.send(new InvokeCommand({
    FunctionName: ENRICH_FUNCTION,
    InvocationType: 'RequestResponse',
    Payload: Buffer.from(JSON.stringify({ imageId, now: Date.now() })),
  }));
  const payload = res.Payload ? JSON.parse(Buffer.from(res.Payload).toString('utf-8')) : {};
  if (res.FunctionError) throw new Error(`${res.FunctionError}: ${JSON.stringify(payload)}`);
  return payload;
}

async function main() {
  const all = await listTargets();
  const targets = all.slice(0, LIMIT);
  console.log(`対象 ${targets.length} 枚 (全 ${all.length} 件中, ${ALL ? '全再処理' : '未処理のみ'})`);

  let done = 0;
  let failed = 0;
  // 単純な固定並列ワーカーで順次消化(Bedrockのスロットリングを避けるため低並列)。
  const queue = [...targets];
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      try {
        const r = await enrich(id);
        done += 1;
        console.log(`[${done + failed}/${targets.length}] ${id} ok embedded=${r.embedded} tagged=${r.tagged}`);
      } catch (e) {
        failed += 1;
        console.error(`[${done + failed}/${targets.length}] ${id} FAILED: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
  console.log(`完了: 成功 ${done} / 失敗 ${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
