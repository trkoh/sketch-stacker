# sketch-stacker

描いた絵を手間なく保存して、あとから見返せるようにする個人用ツール

## なぜ作ったか

描いた絵を見返すのに手間がかかる

- 紙に描いたものはバラバラになって、どこかへ行く
- デジタルで描いたものはキャンバスデータは残るが、何を描いたか・進捗がどうだったかはいちいち保存しないと残らない
- クラウドに保存しようとすると、フォルダを選んで、ファイル名を付けて、数回タップして……とだるい

Gyazo のようなサービスもあるが、無料だと制限がある。どうせなら自前で作りたかった

### やりたかったこと

- 保存が1タップで終わる — iPad で描いた絵を iOS ショートカットの共有シートから1タップでアップロード
- Web で一覧できる — アップロードした絵がギャラリーに並んで、ブラウザから見返せる

## ギャラリー

https://trkoh.github.io/sketch-stacker/

## 使い方

### 画像をアップロード

Mac/iOS ショートカット（推奨）: https://www.icloud.com/shortcuts/e03d33432d5a432e97b38d9063327115

共有シートから1タップでアップロードできる

curl:

```bash
AUTH=$(echo -n 'username:password' | base64)
IMAGE=$(base64 -i image.png)
curl -X POST \
  -H "Authorization: Basic $AUTH" \
  -H "Content-Type: application/json" \
  -d "{\"image\": \"$IMAGE\"}" \
  https://3p4utkstnb.execute-api.ap-northeast-1.amazonaws.com/prod/upload
```

## アーキテクチャ

- Backend: AWS (Terraform で管理)
  - API Gateway + Lambda: Basic 認証付き画像アップロード
  - S3: 画像ストレージ (Glacier Instant Retrieval)
  - CloudFront: CDN 配信
  - Lambda: S3 イベントトリガーで images.json を自動更新
- Frontend: React (Vite) — GitHub Pages にデプロイ

## 開発

### ローカル開発

```bash
cd viewer-react
npm install
npm run dev
```

開発モードではモックデータを使用。本番ビルドは CloudFront に接続する

### インフラデプロイ

```bash
aws configure sso --profile <profile name>
aws sso login --profile <profile name>

cd terraform
AWS_PROFILE=<profile name> terraform plan
AWS_PROFILE=<profile name> terraform apply
```

### Dev Container

Dev Container Features で以下のツールが利用可能:

- git, gh (GitHub CLI)
- terraform, tflint
- aws-cli
