# sketch-stacker

画像アップロード・共有アプリケーション

## アーキテクチャ

- Backend: AWS (Terraform で管理)
  - API Gateway + Lambda: Basic 認証付き画像アップロード
  - S3: 画像ストレージ (Glacier Instant Retrieval)
  - CloudFront: CDN 配信
  - Lambda: S3 イベントトリガーで images.json を自動更新
- Frontend: React (Vite) - GitHub Pages にデプロイ

## 使い方

### 画像を見る

https://trkoh.github.io/sketch-stacker/

### 画像をアップロード

```bash
AUTH=$(echo -n 'username:password' | base64)
IMAGE=$(base64 -i image.png)
curl -X POST \
  -H "Authorization: Basic $AUTH" \
  -H "Content-Type: application/json" \
  -d "{\"image\": \"$IMAGE\"}" \
  https://3p4utkstnb.execute-api.ap-northeast-1.amazonaws.com/prod/upload
```

Mac/iOS ショートカット: https://www.icloud.com/shortcuts/e03d33432d5a432e97b38d9063327115

## インフラ管理

### 前提条件

```bash
aws configure sso --profile <profile name>
aws sso login --profile <profile name>
```

### デプロイ

```bash
cd terraform
AWS_PROFILE=dev terraform plan
AWS_PROFILE=dev terraform apply
```

## ローカル開発

```bash
cd viewer-react
npm install
npm run dev
```

開発モードではモックデータを使用。本番ビルドは CloudFront に接続する。
