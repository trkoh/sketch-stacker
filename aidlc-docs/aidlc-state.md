# AI-DLC State — sketch-stacker

- Workflow: AI-DLC v1.0.0
- Workspace: **Brownfield**（既存: React/Vite + Terraform + Lambda）
- Phase: 🔵 INCEPTION（完了間近）→ 次 🟢 CONSTRUCTION
- Stage: **Workflow Planning 完了 → Construction 開始の承認ゲート**
- Updated: 2026-06-27

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
- [ ] **Construction 開始の承認**（← 現在ここ）
- [ ] Construction: U1 → U2 → U3 → U4
