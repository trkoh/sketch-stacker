# 引き継ぎ書 — sketch-stacker Phase 1（2026-06-27 時点）

## 0. 一言サマリ
描いた絵に「振り返りメモ＋自動タグ＋意味検索」を足す Phase 1。
**Inception 完了 / Construction U1・U2 は本番反映＆実機検証済み / U3 着手中（U3a=タグ絞り込みは PR #32）/ U4 未着手。**

---

## 1. リポジトリ構成 / デプロイ
- repo: `trkoh/sketch-stacker`
- バックエンド: `terraform/`（AWS・Terraform が正本。apply はオーナー）
- フロント: `viewer-react/`（React+Vite）→ **GitHub Pages へ自動デプロイ**（`.github/workflows/deploy.yml`：main への push で build→Pages 公開。PRでは公開しない）
- AI-DLC 運用ドキュメント: `aidlc-docs/`（`aidlc-state.md` 状態 / `audit.md` 監査 / `inception/` 要件・ADR・計画）

## 2. インフラ実値（確定・実コード由来）
| 項目 | 値 |
|---|---|
| AWSアカウント / stackリージョン / profile | `791464527050` / `ap-northeast-1` / `dev`（AWS SSO） |
| **Bedrockリージョン** | **`us-east-1`**（Nova埋め込みは us-east-1 のみ。Lambdaは東京、Bedrock呼び出しだけクロスリージョン） |
| DynamoDB | `WIPUploader-ImageMetadata`（hash_key=`imageId`=`<timestamp>.png`） |
| Lambda | upload=`WIPUploader-UploadFunction-hJDSjvqD9eM7` / authorizer=`WIPUploader-AuthorizerFunction-7WKXvtdhJ2Lx` / update-images=`WIPUploaderUpdateImagesJsonFunction` / delete / enrich=`WIPUploader-ImageEnrichFunction` |
| S3バケット | `wip-uploader-strage` |
| API | `https://3p4utkstnb.execute-api.ap-northeast-1.amazonaws.com/prod`（`POST /upload`, `DELETE /images/{key}`） |
| 認証 | Basic認証。Secret=`WIPUploaderSecret`（JSONキー `secret_key`=パスワード）、username=authorizer env `AUTH_USERNAME`（=`terakou`） |
| CloudFront | `d3a21s3joww9j4.cloudfront.net`（`images.json`, `viewer/metadata.json`） |

> ⚠️ 別スタック `ImageUploader*`（`image-uploader-strage` 等）は別アプリ **image-share-app** のもの。**触るな・消すな**（[[aws-two-stacks-live-wip]]）。

## 3. データフロー
1. **upload**（API＋Basic認証, body `{"image":"<base64 PNG>"}`）→ PNG検証(#20) → S3保存 → DDB基本レコード作成（`visibility=private`）→ **enrich を非同期invoke**（fire-and-forget）。
2. **enrich** → S3から画像取得 → **Nova埋め込み(1024次元)** ＋ **Nova Liteタグ(日本語)** を並列生成 → DDB `UpdateItem`（`embedding`=JSON文字列, `autoTags`=SS, `enrichedAt`）。失敗してもuploadは成功扱い（後でバックフィル可）。
3. **S3 ObjectCreated(.png)** → **update-images** → `images.json`（キー配列）＋ `viewer/metadata.json`（`imageId/uploadedAt/autoTags/memo`※memoは公開のみ）を生成し CloudFront invalidate。
4. **フロント** → `images.json`＋`metadata.json` を取得し表示（U3aでタグ絞り込み）。

## 4. 進捗（AI-DLC / Construction）
- Inception 完了：requirements / ADR-001〜004 / 実行計画（`aidlc-docs/inception/`）
- **U1 メタ基盤**（PR #28）反映済
- **U2 自動タグ＋埋め込み**（#29）＋ 依存バンドル（#30）＋ タグモデル修正（#31）反映済・**実機検証済**
  - 実証: 実画像 enrich→`embedded:true/tagged:true`、DDBに日本語タグ10個＋1024次元ベクトル、API upload→自動enrich連鎖も確認
- **U3 検索**：U3a タグ絞り込み=**PR #32 オープン（未マージ）**。U3b 意味検索=**未着手**
- **U4 メモ編集＋非公開API**：**未着手**

## 5. 重要な決定・ハマりどころ（必読）
- **ADR-004（タグモデル）= `amazon.nova-lite-v1:0`**。理由（**実機検証で判明**）：`anthropic.claude-3-haiku-20240307-v1:0` は **Legacy化で InvokeModel 不可**、Claude 3.5系は **EOL**、Claude 4.5系（`us.anthropic.claude-haiku-4-5-*` 等）は active だが **アカウントへの Anthropic 用途フォーム提出が必須**（オーナーのコンソール操作）。Nova Lite は用途フォーム不要・即動作・低コスト・画像入力対応。
  - enrich は `TAG_MODEL_ID` 接頭辞で body 形式を分岐：`amazon.nova*`=Nova `messages-v1`（応答 `output.message.content[].text`）/ それ以外=Anthropic Messages（応答 `content[].text`）。用途フォーム提出後は変数を `us.anthropic.claude-haiku-4-5-20251001-v1:0` 等に変えるだけで Claude に切替可。
- **埋め込み= `amazon.nova-2-multimodal-embeddings-v1:0`**、**同期InvokeModelで動く**（モデルカードの「Invoke非対応」表記は**誤り**＝実機で確認）。次元=1024（TF変数 `embedding_dimension`）。DDBには **JSON文字列**で格納（U3でパースして使う）。
- **教訓: モデルの可用性/APIサポートはモデルカードを鵜呑みにせず、実 InvokeModel で確認すること。**
- **ADR-002（検索方式）= Nova埋め込み＋ブラウザ内コサイン総当たり**（小規模ゆえベクトルDB不要）。
- 全モデルID/Bedrockリージョン/次元は **TF変数**（`terraform/variables.tf`）で差し替え可。
- **Lambda依存同梱（#30）**：Node22ランタイムのSDK同梱は AWS保証外 → `upload`/`image-enrich` は `package.json`＋`package-lock.json`＋`terraform_data` の `npm ci` で同梱。**apply実行ホストに node/npm 必須**。
- **AWS SSOトークンは失効する**（数分〜数日）。AWS操作前に必ず `aws sso login --profile dev`。
- **terraform state はローカル**（S3 backend 未設定）。消失・ロック無しに注意。

## 6. 残作業（優先順）
1. ~~**PR #32（U3aタグ絞り込み）レビュー→マージ**~~ → **完了**（2026-06-28 マージ済 `41c778f`・Pages デプロイ成功）。※ `metadata.json` にタグが載るのは **enrich済み画像のみ**＝バックフィル前はタグが少ない。
2. **バックフィル（既存 518枚・未処理 516枚）**：`cd scripts && npm install`（初回のみ）→ `aws sso login --profile dev` → `AWS_PROFILE=dev REGION=ap-northeast-1 node scripts/backfill-enrich.mjs --limit 5`（試走）→ 全量。**一時費用 ≈ $10.5**（埋め込み≈$0.5＋タグ≈$10）。
   - ⚠ **バックフィルは DDB を更新するだけ**。完了後に **update-images を1回手動invoke**して公開射影 `viewer/metadata.json` を再生成すること（下記）。これをしないとフロントにタグが出ない。
     `aws lambda invoke --function-name WIPUploaderUpdateImagesJsonFunction --payload '{}' --cli-binary-format raw-in-base64-out --profile dev --region ap-northeast-1 /tmp/upd.json`
   - ✅ **通し検証済（2026-06-28）**：1枚 enrich→DDB(autoTags10/embedding1024)→update-images→metadata.json(518件中タグ付き3件、対象画像にタグ反映) を実機確認。スクリプトは依存マニフェスト欠如で初回失敗→`scripts/package.json` 追加で修正済。
   - 実数注記: ハンドオフ初版の「592枚」は概数。DDB 実数は **518件**（処理済2件＝U2検証分）。
3. **U3b 意味検索**：(a) update-images に embedding 射影（**別ファイル `viewer/embeddings.json` 推奨**＝ギャラリー軽量化・検索時に遅延ロード）(b) **クエリ埋め込みLambda＋APIルート**（Nova text 埋め込み・`embeddingPurpose=IMAGE_RETRIEVAL`・dim1024）(c) フロント検索ボックス＋ブラウザ内コサイン。
   - 設計判断（検索エンドポイントを**公開**にするか**オーナー限定(既存authorizer)**にするか＝コスト/悪用リスク）は **ADR-005 で裁定推奨**（憲法「断定しない」）。
4. **U4 メモ編集＋非公開API**：`GET/PUT /memos`（Basic認証・既存authorizer再利用＝ADR-003）。管理UI（`?admin`）にメモ編集＋公開トグル。
5. （任意）terraform state を S3 backend 化。残セキュリティ #14–20 は完了済み。

## 7. 役割分担
- **オーナーのみ**：`terraform apply`、`aws sso login`、Anthropic用途フォーム提出、バックフィル実行（費用発生）、PRマージ。
- **エージェント**：設計・実装・PR作成・`terraform plan` 提示・実機検証（SSO有効時）。main 直pushしない。

## 8. 動作確認の要点（apply後）
- enrich直接: `aws lambda invoke --function-name WIPUploader-ImageEnrichFunction --payload '{"imageId":"<key>"}' ...`
- DDB確認: `aws dynamodb get-item --table-name WIPUploader-ImageMetadata --key '{"imageId":{"S":"<key>"}}'` → `embedding`(JSON文字列)/`autoTags`(SS)/`enrichedAt` を確認
- 全文手順はセッション履歴の「apply手順 STEP0〜8」を参照。
