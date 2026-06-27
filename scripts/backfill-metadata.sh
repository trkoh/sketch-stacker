#!/usr/bin/env bash
# U1: 既存画像(.png)を DynamoDB メタデータ基盤に「基本レコード」として投入する一度きりのスクリプト。
# - imageId = S3キー(<timestamp>.png) / uploadedAt = ファイル名のtimestamp / visibility = private
# - memo / autoTags / embedding は付けない（U2 のバックフィルで付与する）
# - 既存レコードは上書きしない（attribute_not_exists 条件）。何度流しても安全。
#
# 前提: aws CLI + dev プロファイルでログイン済み（aws sso login --profile dev）。
# 使い方: bash scripts/backfill-metadata.sh
set -euo pipefail

PROFILE="${AWS_PROFILE:-dev}"
REGION="ap-northeast-1"
TABLE="WIPUploader-ImageMetadata"
BUCKET="wip-uploader-strage"

echo "テーブル: $TABLE / バケット: $BUCKET / プロファイル: $PROFILE"

# .png のキーだけを取得（viewer/ 配下の images.json 等は除外＝.pngで絞る）
keys=$(aws s3api list-objects-v2 --bucket "$BUCKET" --profile "$PROFILE" --region "$REGION" \
  --query "Contents[?ends_with(Key, '.png')].Key" --output text | tr '\t' '\n')

total=0; added=0; skipped=0
for key in $keys; do
  [ -z "$key" ] && continue
  total=$((total+1))
  # ファイル名先頭の数値(10〜13桁)を uploadedAt に。取れなければ現在時刻(ms)。
  ts=$(printf '%s' "$key" | grep -oE '^[0-9]{10,13}' || true)
  [ -z "$ts" ] && ts=$(date +%s)000
  if aws dynamodb put-item --table-name "$TABLE" --profile "$PROFILE" --region "$REGION" \
       --item "{\"imageId\":{\"S\":\"$key\"},\"uploadedAt\":{\"N\":\"$ts\"},\"visibility\":{\"S\":\"private\"}}" \
       --condition-expression "attribute_not_exists(imageId)" >/dev/null 2>&1; then
    added=$((added+1))
  else
    skipped=$((skipped+1)) # 既存 or エラー
  fi
done

echo "完了: 対象 $total 件 / 追加 $added 件 / スキップ(既存等) $skipped 件"
