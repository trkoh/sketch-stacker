# iOSショートカット: リファレンス写真を1タップ保存（U-P1）

写真アプリの共有シートから1タップで、リファレンス写真を **非公開バケット** にアップロードするショートカットのレシピ。既存の「絵のアップロード」ショートカットの複製から作るのが早い。

## 動作
共有シートで写真を選ぶ → （任意）撮影メモを入力 → 非公開保存 → 管理UI（`?admin` → 「写真を表示」）で閲覧・メモ編集

## レシピ（ショートカットApp での組み方）

1. **新規ショートカット** → 詳細で「共有シートに表示」をON、受け取る種類を「イメージ」に限定
2. アクション: **イメージのサイズを変更** — 最長辺 `2048` px（API Gateway の10MB制限内に収めるため。原寸はiCloud写真に残る）
3. アクション: **イメージを変換** — フォーマット `JPEG`（HEICはAPIが受理しないため必須）
4. アクション: **入力を要求** — 質問「撮影メモ（スキップ可）」/ テキスト / デフォルト空欄
   - メモ不要ならこのステップごと削除してよい（後から管理UIで書ける）
5. アクション: **Base64エンコード** — 対象は手順3の変換済みイメージ
6. アクション: **URLの内容を取得**
   - URL: `https://3p4utkstnb.execute-api.ap-northeast-1.amazonaws.com/prod/photos`
   - 方法: `POST`
   - ヘッダ:
     - `Authorization`: `Basic <base64("ユーザー名:アップロード用パスワード")>`
       - 既存の絵のショートカットと同じ値でよい（upload用 secret_key。管理用 admin_key ではない）
     - `Content-Type`: `application/json`
   - 本文（JSON）:
     ```json
     { "image": "<手順5のBase64>", "memo": "<手順4の入力>" }
     ```

## curl での代替

```bash
AUTH=$(echo -n '<username>:<upload用パスワード>' | base64)
IMAGE=$(base64 -i photo.jpg)
curl -X POST \
  -H "Authorization: Basic $AUTH" \
  -H "Content-Type: application/json" \
  -d "{\"image\": \"$IMAGE\", \"memo\": \"夕方の光が良かった\"}" \
  https://3p4utkstnb.execute-api.ap-northeast-1.amazonaws.com/prod/photos
```

## 注意
- 写真は**常に非公開**（公開ギャラリー・CDNには一切出ない。専用の非公開バケット＋署名URL閲覧）
- 対応形式: JPEG / PNG / GIF / WebP（HEICは手順3で変換すること）
- 1リクエスト実質約7MBまで（base64膨張分込み）→ 手順2のリサイズで担保
- 削除は管理UIから（バージョニングにより一定期間は復旧可能）
