# sketch-stacker

描いた絵を手間なく保存して、あとから見返せるようにする個人用ツール

## なぜ作ったか

描いた絵を見返すのに手間がかかるため。具体的には、

- 紙に描いたものは分散して後から見返しづらい
- デジタルで描いたものはキャンバスデータは残るが、何を描いたか・進捗がどうだったかはいちいち保存しないと残らない
- クラウドに保存しようとすると、フォルダを選んで、ファイル名を付けて、数回タップして……という作業が割と手間
  - 各クラウドサービスごとのクライアントアプリ、ログイン認証が必要

など。

類似の機能(画像upload & share)を提供するサービスとしては [Gyazo](https://gyazo.com/ja) があるが、無料枠だと画像アクセスに制限がある

### やりたかったこと

- 保存が1タップで終わる
  - iPad で描いた絵/写真で撮った絵を iOS ショートカットの共有シートから1タップでアップロード
- Web で一覧できる
  - アップロードした絵がギャラリーに並んで、ブラウザから見返せる

## ギャラリー

https://trkoh.github.io/sketch-stacker/

## 使い方

### 画像をアップロード

Mac/iOS ショートカット: https://www.icloud.com/shortcuts/e03d33432d5a432e97b38d9063327115

共有シートから1タップでアップロードする

curl:

```bash
AUTH=$(echo -n 'username:password' | base64)
IMAGE=$(base64 -i image.png)
curl -X POST \
  -H "Authorization: Basic $AUTH" \
  -H "Content-Type: application/json" \
  -d "{\"image\": \"$IMAGE\"}" \
  https://3<api gatewayのエンドポイント>prod/upload
```

## アーキテクチャ

- Backend: AWS (Terraform で管理)
  - API Gateway + Lambda: Basic 認証付き画像アップロード
  - S3: 画像ストレージ (Glacier Instant Retrieval)
  - CloudFront: CDN 配信
  - Lambda: S3 イベントトリガーで images.json を自動更新
- Frontend: React
- デプロイ: GitHub Action, GitHub Pages

## 開発フロー

コードは Git で管理し、**編集はどこからでも（スマホの Claude アプリ含む）**。反映は必ず **PR → main へマージ** 経由で、CI が自動でデプロイする。**main への直接 push はしない。**

### デプロイの流れ

```
コード編集 → feature ブランチ → PR
     │
     ├─ フロント (viewer-react/) 変更  ─┐
     └─ インフラ (terraform/) 変更     │
                                        ▼
                              PR 上で CI が検証
   ・terraform 変更 → `terraform plan` を自動実行（結果を確認）
   ・フロント変更   → lint + build
                                        │
                                    マージ
                                        ▼
                              main への push で CI が反映
   ・フロント → GitHub Pages へ公開          （.github/workflows/deploy.yml）
   ・インフラ → `terraform apply`（OIDC 鍵レス）（.github/workflows/terraform.yml）
```

### 基本ルール

- **インフラのデプロイは CI が正本**。`terraform apply` を**手元（特に Mac）で実行しない**。
  - 理由: 一部 Lambda は zip ビルドが OS 依存で、ローカルの `terraform plan` は該当関数を常に「変更あり」と表示する（＝正常・無視してよい）。反映は push→マージで CI に任せる。
- **AWS の鍵は CI では不要**（GitHub Actions が OIDC で一時認証。長期キーなし）。
  - `aws` CLI やスクリプト（バックフィル等）を**手元/コンテナから直接**叩くときだけ認証が必要 → `aws sso login --profile dev`。
- state は S3 backend（リモート）で共有。ネイティブロックあり。
- 詳細な設定値・運用手順・機能仕様は `CLAUDE.md` と各 issue/PR を参照。

### ローカルでの確認（任意）

```bash
cd viewer-react
npm install
npm run dev -- --host     # 開発サーバ（モックデータ）
npm run build             # 本番ビルド
npm run lint              # Lint
```
