# sketch-stacker

描いた絵を手間なく保存して、あとから見返せるようにする個人用ツール

## なぜ作ったか

描いた絵を見返すのに手間がかかる

- 紙に描いたものは分散して後から見返しづらい
- デジタルで描いたものはキャンバスデータは残るが、何を描いたか・進捗がどうだったかはいちいち保存しないと残らない
- クラウドに保存しようとすると、フォルダを選んで、ファイル名を付けて、数回タップして……という作業が割と手間
  - 各クラウドサービスごとのクライアントアプリ、ログイン認証が必要

- Gyazo のようなサービスもあるが、無料枠だと画像アクセスに制限がある

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
- Frontend: React (Vite) — GitHub Pages にデプロイ
