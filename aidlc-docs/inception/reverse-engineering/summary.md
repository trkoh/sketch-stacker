# Reverse Engineering 要約（既存 sketch-stacker）

## アーキテクチャ（現状・本番=WIP系）
```
iOS Shortcut / curl --Basic認証--> API Gateway (3p4utkstnb)
   POST /upload          -> authorizer Lambda(専用ロール/Secrets照合) -> upload Lambda -> S3(wip-uploader-strage) <timestamp>.png (GLACIER_IR)
   DELETE /images/{key}  -> authorizer -> delete Lambda -> S3 DeleteObject（versioningで論理削除）
S3 ObjectCreated/Removed(.png) -> update-images Lambda -> viewer/images.json 再生成 -> CloudFront(d3a21s3joww9j4) invalidate
React(GitHub Pages: odayakalife.dev/sketch-stacker) -> images.json を fetch -> マソンリー＋GitHub風カレンダー表示／?admin で削除UI
```

## 技術スタック
- インフラ: Terraform（IaC正本、state=ローカル）。AWS account 791464527050 / ap-northeast-1
- Lambda: Node.js 22（upload / authorizer / update-images / delete）
- フロント: React 19 + Vite 7、GitHub Actions で GitHub Pages へデプロイ（mainマージで自動）
- 認証: Basic認証（authorizer Lambda が Secrets Manager と照合）。**閲覧は完全公開・無認証**

## データモデル（現状＝ほぼ無し）
- メタデータは実質「ファイル名＝タイムスタンプ」のみ。`images.json` は **ファイル名の配列だけ**（`["1736680321651.png", ...]`）。
- 日付はファイル名から算出。タイトル/タグ/メモ等は**存在しない**。

## Phase 1 拡張で不足している土台
- 1作品=1レコードの**メタデータ基盤が無い**（→ メモ・タグ・公開フラグ・ベクトルを持てない）
- **非公開データの認証付き読み取り経路が無い**（閲覧が全公開のため）
- 検索機構が無い

## 別系統（さわらない）
- ImageUploader系（image-uploader-strage / d3bbpjrhbo1x61 / API l2ljx0c2hg）は**別アプリ image-share-app のバックエンド**。本リポジトリ管理外・削除厳禁。
