# 引き継ぎ書 — sketch-stacker Phase 1（2026-07-01 時点）

## 0. 一言サマリ
描いた絵に「振り返りメモ＋自動タグ＋意味検索」を足す Phase 1。
**Phase 1 機能的に完了。U1〜U4 すべて本番反映＆実機検証済み。既存全600枚のバックフィル完了（601 DDBレコードが embedding 済・タグ付き594）＝ギャラリー全600枚がタグ絞り込み・意味検索の対象。**
**残: PR #40（孤立画像登録スクリプト＋本ドキュメント）マージのみ / ADR-005（検索エンドポイント=オーナー限定）オーナー批准待ち。次フェーズは Phase 2＝リファレンス写真管理（未着手・要 Inception）。**

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

## 4. 進捗（AI-DLC / Construction）— Phase 1 完了
- Inception 完了：requirements / ADR-001〜005 / 実行計画（`aidlc-docs/inception/`）
- **U1 メタ基盤**（#28）／**U2 自動タグ＋埋め込み**（#29/#30/#31）反映済・実機検証済
- **U3a タグ絞り込み**（#32・フロント client-side・公開）反映済
- **U3b 意味検索**（#34・query-embed Lambda＋`POST /search`＋`viewer/embeddings.json`射影＋ブラウザ内コサイン。**オーナー限定**=既存authorizer・ADR-005=A）反映済・実機検証済
- **U4 メモ編集＋非公開API**（#36・memos Lambda＋`GET/PUT /memos/{key}`＋管理モードUI・デフォルト非公開）反映済・実機検証済
- **バックフィル完了**：全601 DDBレコード embedding済（タグ付き594）。`embeddings.json`=601 / `metadata.json` タグ付き594 / `images.json`=600（viewer/混入0）。ギャラリー全600枚がタグ・検索対象。
- **バックフィルで見つけて直した実バグ**（全て本番反映）:
  - **#35** タグ重複→DDB String Set拒否でUpdateItem丸ごと失敗（埋め込みも巻き添え）→ Setで重複除去。
  - **#37** `images.json`にviewer/運用ファイル混入→ギャラリーに壊れたタイル→ 接頭辞除外（フロント＋update-images）。
  - **#39** 中身JPEGなのに.png拡張子→enrichが`format:'png'`決め打ち→Bedrock MIME不一致で両失敗→ マジックナンバーで実形式判定。
  - **#38** backfillの対象スキャンが結果整合で収束せず→ `ConsistentRead`化。
  - **#40（マージ待ち）** バケットにあってDDB未登録のJPG/JPEG 80枚を登録する `scripts/register-orphan-images.mjs`。登録→enrichで全600枚カバー達成。

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

## 6. 残作業
Phase 1（U1〜U4＋バックフィル）は完了。残りは以下:
1. **PR #40 マージ**（`scripts/register-orphan-images.mjs`＋本ドキュメント更新）。apply不要・スクリプトはローカル実行。
2. **ADR-005 のオーナー批准**：意味検索 `POST /search` を**オーナー限定（案A・実装済）**のままにするか、公開（案B・要レート制限）にするか。公開化するなら method の authorizer を外す1行＋別ADRでレート制限。
3. **（任意・軽微）** DDBゴーストレコード1件（S3に画像実体なし・過去削除分）。images.json に出ないので表示・検索影響なし。消すなら明示指示で。
4. **（任意）** terraform state を S3 backend 化（現状ローカル・ロック無し）。
5. **次フェーズ = Phase 2（リファレンス写真管理）**：未着手。issue #21 の構想。新機能なので Inception（要件ヒアリング）から。

### バックフィル再実行が要るとき（新規追加画像や再処理）
```
cd scripts && npm install            # 初回のみ
aws sso login --profile dev
# バケットにあってDB未登録の画像を登録（JPG/JPEG等）
AWS_PROFILE=dev REGION=ap-northeast-1 node scripts/register-orphan-images.mjs
# 未embedding を enrich（JPEG対応・ConsistentReadで収束）
AWS_PROFILE=dev REGION=ap-northeast-1 CONCURRENCY=1 node scripts/backfill-enrich.mjs
# 公開射影を再生成（★これを忘れるとフロントに反映されない。enrich直後は結果整合ラグで
#   件数が古く出ることがある＝少し待って もう一度叩けば正しい件数になる）
aws lambda invoke --function-name WIPUploaderUpdateImagesJsonFunction --payload '{}' \
  --cli-binary-format raw-in-base64-out --profile dev --region ap-northeast-1 /tmp/upd.json
```

## 7. 役割分担
- **オーナーのみ**：`terraform apply`、`aws sso login`、Anthropic用途フォーム提出、バックフィル実行（費用発生）、PRマージ。
- **エージェント**：設計・実装・PR作成・`terraform plan` 提示・実機検証（SSO有効時）。main 直pushしない。

## 8. 動作確認の要点（apply後）
- enrich直接: `aws lambda invoke --function-name WIPUploader-ImageEnrichFunction --payload '{"imageId":"<key>"}' ...`
- DDB確認: `aws dynamodb get-item --table-name WIPUploader-ImageMetadata --key '{"imageId":{"S":"<key>"}}'` → `embedding`(JSON文字列)/`autoTags`(SS)/`enrichedAt` を確認
- 全文手順はセッション履歴の「apply手順 STEP0〜8」を参照。
