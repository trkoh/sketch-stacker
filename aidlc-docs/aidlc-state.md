# AI-DLC State — sketch-stacker

- Workflow: AI-DLC v1.0.0
- Workspace: **Brownfield**（既存: React/Vite + Terraform + Lambda）
- Phase: 🟢 CONSTRUCTION（U1/U2/U3a 完了・本番反映済）
- Stage: **U3a マージ済（#32）→ 次は バックフィル（オーナー）/ U3b意味検索 or U4メモ**
- Updated: 2026-06-28

## Intent
Phase 1（issue #21 / #22）: 描いた絵に「振り返りメモ」を紐づけ、**手動タグ無しでモチーフを意味検索**できるギャラリーへ拡張する。

## 確定した要件（requirements/requirements.md）
- メモ = 自由記述1欄 / 自動タグ(日本語) = 公開 / バックフィル = 埋め込み＋タグ(≈$10) / 検索 = ADR-002で決定

## 確定した設計（adr/adrs.md・2026-06-27 オーナー裁定）
- **ADR-001 = DynamoDB（オンデマンド）**
- **ADR-002 = Bedrock Nova 埋め込み＋ブラウザ内コサイン**
- **ADR-003 = 既存 authorizer 再利用＋公開分のみ射影**

## 実行計画（workflow-planning/execution-plan.md）
- U1 メタデータ基盤 → U2 自動タグ＋埋め込み → U3 検索/絞り込み → U4 メモ編集＋非公開API
- 各Unit = featureブランチ＋PR、Terraformは plan提示・apply はオーナー

## 既決事項（issue #21/#22 §3）
- メモ/写真は公開/非公開トグル・デフォルト非公開、Phase1=絵＋メモ＋検索、Notion連携なし、単一ユーザー、低コスト最優先、Terraform=IaC正本、断定せずADR裁定
- セキュリティ #14〜#20 対応済み

## ステージ進捗
- [x] Workspace Detection（brownfield）
- [x] Reverse Engineering（要約記録）
- [x] Requirements Analysis（確定）
- [x] ADR（ADR-001/002/003 裁定済み）
- [x] Workflow Planning（実行計画作成）
- [x] **Construction 開始の承認**
- [x] U1 メタデータ基盤（#28 マージ済）
- [x] U2 自動タグ＋埋め込み（#29/#30/#31 マージ済・実機検証済）
- [x] U3a タグ絞り込み（#32 マージ済・Pages デプロイ成功 2026-06-28）
- [x] U3b 意味検索（#34 マージ・apply・実機検証済 2026-06-28）
- [~] U4 メモ編集＋非公開API（PR #36・ADR-003 で authorizer 再利用）。memos Lambda＋GET/PUT /memos/{key}（Basic認証）＋管理モードのメモ編集UI（公開/非公開トグル・デフォルト非公開）。保存後 update-images を非同期invokeして公開射影更新。terraform plan / lint / build 通過。apply はオーナー
- [~] バックフィル（2026-06-28 実行）: 469枚 embedding / 464枚 tagged を本番反映（metadata.json 518件中タグ付き464、embeddings.json 469件）。**残49枚は enrich の重複タグバグで失敗**＝#35 で修正（マージ済）、apply 後に再実行で回収。

## U2 設計メモ（2026-06-27 オーナー承認: A案=非同期）
- 生成タイミング: upload Lambda が S3保存+基本レコード作成の後に **enrich Lambda を Event invoke**（fire-and-forget）。S3 ObjectCreated は update-images が同条件で使用中=2本目トリガ不可のため、トリガ機構のみS3でなく直接async invoke（承認済み性質: 即返し/疎結合/障害隔離/バックフィル再利用は維持）。
- API正本(スキル/AWS公式で確認): Nova埋め込み `SINGLE_EMBEDDING`・inline base64・レスポンス `embeddings[0].embedding`。Claude on Bedrock InvokeModel `anthropic_version:"bedrock-2023-05-31"`・Messages形式・レスポンス `content[].text`。**画像対応は Claude 3 Haiku**（3.5 Haikuは画像不可）。
- モデルID/Bedrockリージョン/埋め込み次元はTF変数化（断定しない・apply時に調整可）。
- 既存592枚は `scripts/backfill-enrich.mjs` をオーナーが一度だけ実行（一時費用≈$10.5）。
- **ADR-004 裁定済**(2026-06-27): データ所在=要件なし → Bedrock=**us-east-1**(Nova唯一の提供地・東京にMM埋め込み無し)/タグ=**Claude 3 Haiku**(画像可の最安)/埋め込み=Nova。選定経緯とリージョン可用性を adrs.md に文書化。
