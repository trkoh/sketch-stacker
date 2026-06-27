# Workflow Planning — Phase 1 実行計画（承認待ち）

## 確定した設計（ADR）
- ADR-001: メタデータ = **DynamoDB（オンデマンド）**
- ADR-002: 検索 = **Bedrock Nova 埋め込み＋ブラウザ内コサイン総当たり**
- ADR-003: 非公開配信 = **既存 authorizer 再利用＋公開分のみ射影**

## データモデル（DynamoDB：1画像=1アイテム）
```
PK: imageId  (= 既存の <timestamp>.png)
  uploadedAt   : number
  memo         : string   （自由記述・デフォルト非公開）
  visibility   : "private" | "public"   （memoの公開制御。default private）
  autoTags     : string[] （日本語モチーフ・公開）
  embedding    : number[] （Nova ベクトル・検索用）
```
- **公開射影**: 公開JSON（images.json後継）には `imageId / uploadedAt / autoTags /（visibility=publicならmemo）` と、検索用に embedding（公開画像分）を出す。**非公開memoはCDNに出さない**。

## Unit of Work（独立PR単位・順序）
| # | Unit | 主な成果物 | 依存 |
|---|---|---|---|
| **U1** | メタデータ基盤 | DynamoDBテーブル(TF)／upload時にレコード作成／公開JSON射影パイプライン（update-images改修 or 新Lambda） | — |
| **U2** | 自動タグ＋埋め込み生成 | アップロード時に Bedrock Nova(埋め込み)＋Claude Haiku(日本語タグ)→DynamoDB／IAM・Bedrock権限(TF)／**既存592枚バックフィルスクリプト** | U1 |
| **U3** | 検索＆タグ絞り込み | クエリ埋め込みAPI（Nova、1本）／フロント：意味検索ボックス＋タグ絞り込み（ブラウザ内コサイン） | U2 |
| **U4** | メモ編集＋非公開API | GET/PUT `/memos`（Basic認証・既存authorizer再利用）／管理UIにメモ編集＋公開トグル | U1 |

## 進め方（憲法準拠）
- 各Unitを **featureブランチ＋PR**。Terraform変更は `plan` 提示、**apply はオーナー**。
- Unit内: Functional Design → 必要なら NFR → Code Generation（計画→承認→生成）→ Build/Test。
- 推奨着手順: **U1 → U2 → U3 → U4**（U4はU1後ならU2/U3と並行可）。

## コスト再掲（出典: #21）
- 継続増分 ≈$0〜1/月（DynamoDB無料枠／検索はブラウザ内＝$0）
- 初回バックフィル（U2・一度きり）: 埋め込み≈$0.5 ＋ 日本語タグ≈$10
