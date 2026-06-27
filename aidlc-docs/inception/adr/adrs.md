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

---

## ADR-004：自動タグ生成モデル & Bedrockリージョン（U2・2026-06-27 オーナー裁定）

> 当初 U2 実装時にインラインで決めてしまった判断を、後追いで正式ADR化（手続き上の落ち度の是正）。

### 一次分岐：データ所在の要件 → **「要件なし」と裁定**（画像は既にCloudFrontで全世界公開のため所在を守る実益が無い）

### リージョン可用性（裏取り済み・決定的事実）
| モデル種別 | 東京(ap-northeast-1) | 出典 |
|---|---|---|
| Nova multimodal embeddings | **無し**（us-east-1のみ） | [AWS発表](https://aws.amazon.com/blogs/aws/amazon-nova-multimodal-embeddings-now-available-in-amazon-bedrock/) |
| Titan Multimodal Embeddings G1 | **無し**（us-east-1 / us-west-2） | [リージョン対応表](https://docs.aws.amazon.com/bedrock/latest/userguide/models-region-compatibility.html) |
| vision可Claude(jp.*推論プロファイル) | 可(Sonnet4.5/Haiku4.5) | [Japanクロスリージョン推論](https://aws.amazon.com/blogs/machine-learning/introducing-amazon-bedrock-cross-region-inference-for-claude-sonnet-4-5-and-haiku-4-5-in-japan-and-australia/) |

→ **東京にはBedrock製マルチモーダル埋め込みが存在しない**。東京完結は埋め込み(ADR-002=Nova)をCLIPに作り直す設計変更を強いる＝半端で高コスト。所在要件が無い以上、不採用。

### 裁定
- **Bedrockリージョン = us-east-1**（Nova の唯一の提供地・Claude 3 Haiku もオンデマンド可。Lambda本体は東京、Bedrock呼び出しのみクロスリージョン＝非同期enrichなので体感無影響）。
- **埋め込み = Nova `amazon.nova-2-multimodal-embeddings-v1:0`**（ADR-002踏襲。日本語200言語が検索の決め手）。
- **タグ = Claude 3 Haiku `anthropic.claude-3-haiku-20240307-v1:0`**。

### タグモデル比較（vision必須・5000枚バルク・憲法「低コスト最優先」）
| 候補 | 画像入力 | 提供 | コスト | 判定 |
|---|---|---|---|---|
| **Claude 3 Haiku** | 可（[モデルカード](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-3-haiku.html)） | us-east-1オンデマンド | 最安（タグ≈$10/5000枚, #21試算） | ✅採用 |
| Claude 3.5 Haiku | **不可（テキスト専用）** | — | 安 | ✗用途不成立 |
| Claude 3.5 Sonnet / 4.x vision | 可 | 一部プロファイル必須 | 高 | ✗バルクに過剰 |

- **決め手**: 「画像が読める最安のHaiku」。確信度: 中〜高。
- **可変性**: モデルID/リージョン/次元はTF変数。将来タグ品質を上げたければ ADR追補で上位モデルへ差し替え可。

### ADR-004 改定（2026-06-27・us-east-1 実機検証で上記タグ裁定を覆す）
机上のモデルカードを信じた当初裁定が**実機で破綻**したため改定。AdministratorAccess で us-east-1 に実 InvokeModel して確認した結果：

| モデル | 実機結果 |
|---|---|
| `amazon.nova-2-multimodal-embeddings-v1:0`（埋め込み） | ✅ 同期InvokeModel成功（`embeddings[0].embedding` 返却）。モデルカードの「Invoke非対応」表記は誤り。**埋め込みは変更なし**。 |
| `anthropic.claude-3-haiku-20240307-v1:0`（旧タグ裁定） | ❌ `ResourceNotFoundException`「This Model is marked by provider as **Legacy** … upgrade to an active model」＝**呼べない** |
| `anthropic.claude-3-5-sonnet-*`（20240620/20241022, 直/us.） | ❌ 全て「model version has reached **end of life**」 |
| `us.anthropic.claude-haiku-4-5-*` / `us.anthropic.claude-sonnet-4-5-*` | △ active だが「**Model use case details have not been submitted**」＝アカウントへ Anthropic 用途フォーム提出が必須（コンソール操作・オーナーのみ可）＋`us.`プロファイル必須 |
| **`amazon.nova-lite-v1:0`**（新タグ裁定） | ✅ **画像→日本語タグJSONを即返却**（用途フォーム不要・低コスト・マルチモーダル・多言語）。実応答例: `["カフェ","コーヒー","食器","テーブル","カップ"]` |

**改定裁定（タグ生成）= `amazon.nova-lite-v1:0`**。理由: Anthropic系は全滅(Legacy/EOL)か用途フォーム待ち(=オーナー操作でブロック)で**今すぐ動かない**。Nova Lite は提出不要で即動作・低コスト・画像入力対応＝憲法「低コスト最優先」にも合致。
- enrich は `TAG_MODEL_ID` 接頭辞で body 形式を分岐（`amazon.nova*`=messages-v1 / それ以外=Anthropic Messages）。用途フォーム提出後に Claude Haiku 4.5（`us.` プロファイル）へ変数差し替え可能。
- **教訓**: 可用性・APIサポートはモデルカードを鵜呑みにせず実 InvokeModel で確認する（埋め込みの「Invoke非対応」表記も実機では誤りだった）。
