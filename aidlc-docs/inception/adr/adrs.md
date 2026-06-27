# ADR — Phase 1 設計判断（オーナー裁定待ち）

各案：トレードオフ＋出典＋確信度を併記。憲法どおり断定せずオーナーが裁定する。

---

## ADR-001：メタデータの格納先

| 案 | 内容 | トレードオフ |
|---|---|---|
| **A. DynamoDB（オンデマンド）** | 1画像=1アイテム。memo/tags/visibility/embedding 等を保持 | スケーラブル・無料枠内・検索/フィルタ容易・サーバレス親和。NoSQL設計の学習要 |
| B. S3 サイドカーJSON | 画像ごとに `<key>.json` を併置 | 追加インフラ最小だが、一覧/検索が重い・整合性管理が面倒 |
| C. 既存 images.json 拡張 | 配列→オブジェクト配列に拡張 | 最小変更だが、件数増で肥大・更新競合・1ファイル全書き換え |

- **出典**: [DynamoDB料金/無料枠](https://aws.amazon.com/dynamodb/pricing/)（25GB・月2億req無料枠＝この規模実質$0）、issue #11（DynamoDB推奨）
- **推奨**: **A（DynamoDB）**　**確信度: 高**（規模・コスト・拡張性で妥当。#11方針とも一致）

---

## ADR-002：セマンティック検索の方式（※Q4で保留→ここで裁定）

| 案 | 内容 | トレードオフ |
|---|---|---|
| **A. Bedrock Nova 埋め込み＋ブラウザ内コサイン総当たり** | 画像/クエリを Nova でベクトル化、事前計算JSONを配信、ブラウザで総当たり比較 | 日本語200言語対応・ランニング≈$0・実装容易。画像をBedrockに送る（※画像は既に公開CDN上なので新たな機密漏れではない）・クラウド依存 |
| B. ブラウザ内 多言語CLIP（Transformers.js） | モデルをブラウザで実行 | 完全無料・ローカル・画像を外に出さない。**モデルDLが重い(数十〜百MB)**・初回ロード遅・日本語精度はモデル次第 |
| C. ベクトルDB（OpenSearch Serverless 等） | 専用ベクトル検索基盤 | 数百〜数千枚には**過剰**・月額コスト高 |

- **出典**: [Nova多モーダル埋め込み発表](https://aws.amazon.com/blogs/aws/amazon-nova-multimodal-embeddings-now-available-in-amazon-bedrock/)（最大200言語、model `amazon.nova-2-multimodal-embeddings-v1:0`）、[Pinecone/CLIP](https://www.pinecone.io/learn/series/image-search/clip/)（zero-shot＋コサイン）、[Ultralytics](https://docs.ultralytics.com/guides/similarity-search/)
- **推奨**: **A（Nova＋ブラウザ内コサイン）**　**確信度: 中〜高**（小規模ゆえベクトルDB不要、日本語クエリが効くのが決め手）。画像を外部に出したくないなら B。

---

## ADR-003：非公開メモの配信・認証

| 案 | 内容 | トレードオフ |
|---|---|---|
| **A. 既存 authorizer 再利用＋公開分のみ射影** | 公開フラグ付きメタデータだけを公開JSON(images.json後継)に出しCDN配信。非公開メモは新規 `GET /memos`（Basic認証, 既存authorizer再利用）でのみ取得 | 一貫性・追加実装少・既存`?admin`認証と親和。Basic認証の範囲 |
| B. 署名URL / Cognito 等 | 本格的な認証基盤 | 単一ユーザーには過剰・重い |

- **出典**: issue #21 設計方針（「公開フラグ付きだけ射影／非公開は認証API」）、本セッションで実装済みの authorizer（#16 専用ロール化済み）
- **推奨**: **A**　**確信度: 高**（既存資産の再利用、NFR-2プライバシーを満たす最小構成）

---

## 自動タグ公開の反映（Q2回答=公開）
- 自動タグ(autoTags)は**公開JSONに射影**してギャラリー絞り込みに使う。
- メモ本文は visibility に従い、公開のみ射影／非公開は認証API経由。
