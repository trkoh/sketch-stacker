# 引き継ぎ書 — sketch-stacker Phase 1（2026-07-03 時点）

## 0. 一言サマリ
描いた絵に「振り返りメモ＋自動タグ＋意味検索」を足す Phase 1。
**Phase 1 機能的に完了。U1〜U4 すべて本番反映＆実機検証済み。既存画像のバックフィル完了（DDB 603件／S3 603枚で一致・タグ付き596・enrich未了はわずか7件）＝ギャラリー全画像がタグ絞り込み・意味検索の対象。**
**インフラ運用も刷新（2026-07-02）：state を S3 backend 化（#41）＋ GitHub Actions OIDC で鍵レス CI 化（#42）。以後 terraform は push/マージで CI が apply する「CI 正本」運用。ローカル apply はしない（§5/§7）。**
**残: ADR-005（検索エンドポイント=オーナー限定）オーナー批准待ち。次フェーズは Phase 2＝リファレンス写真管理（未着手・要 Inception）。全体ロードマップは §9。**

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
- **バックフィル完了**：DDB 603件 = S3 603枚で一致（#40の孤立JPG/JPEG登録も反映済）。タグ付き596 / enrich未了7件（軽微・再実行で解消可、§6手順）。ギャラリー全画像がタグ・検索対象。
- **インフラ運用刷新（2026-07-02・#41/#42）**：
  - **#41** terraform state を S3 backend 化（`sketch-stacker-tfstate-791464527050`・バージョニング/暗号化/ネイティブロック）＋ S3バケットポリシーの永久ドリフト解消。
  - **#42** GitHub Actions + OIDC で鍵レス CI 化。`.github/workflows/terraform.yml` が PR で `plan`・main への push で `apply`。認証は OIDCロール `sketch-stacker-github-actions`（最小権限・信頼先=当repoの main+PRのみ）。CI入力は repo変数(`AWS_ROLE_ARN`/`IMAGE_BUCKET_NAME`/`CLOUDFRONT_DISTRIBUTION_ID`)＋secret(`BASIC_AUTH_USERNAME`)＝gitignoreの`terraform.tfvars`を代替。**CI初回 apply 成功で実地稼働確認済み。**
- **バックフィルで見つけて直した実バグ**（全て本番反映）:
  - **#35** タグ重複→DDB String Set拒否でUpdateItem丸ごと失敗（埋め込みも巻き添え）→ Setで重複除去。
  - **#37** `images.json`にviewer/運用ファイル混入→ギャラリーに壊れたタイル→ 接頭辞除外（フロント＋update-images）。
  - **#39** 中身JPEGなのに.png拡張子→enrichが`format:'png'`決め打ち→Bedrock MIME不一致で両失敗→ マジックナンバーで実形式判定。
  - **#38** backfillの対象スキャンが結果整合で収束せず→ `ConsistentRead`化。
  - **#40（マージ済）** バケットにあってDDB未登録のJPG/JPEG 80枚を登録する `scripts/register-orphan-images.mjs`。登録→enrichで全画像カバー達成（DDB 603=S3 603）。

## 5. 重要な決定・ハマりどころ（必読）
- **ADR-004（タグモデル）= `amazon.nova-lite-v1:0`**。理由（**実機検証で判明**）：`anthropic.claude-3-haiku-20240307-v1:0` は **Legacy化で InvokeModel 不可**、Claude 3.5系は **EOL**、Claude 4.5系（`us.anthropic.claude-haiku-4-5-*` 等）は active だが **アカウントへの Anthropic 用途フォーム提出が必須**（オーナーのコンソール操作）。Nova Lite は用途フォーム不要・即動作・低コスト・画像入力対応。
  - enrich は `TAG_MODEL_ID` 接頭辞で body 形式を分岐：`amazon.nova*`=Nova `messages-v1`（応答 `output.message.content[].text`）/ それ以外=Anthropic Messages（応答 `content[].text`）。用途フォーム提出後は変数を `us.anthropic.claude-haiku-4-5-20251001-v1:0` 等に変えるだけで Claude に切替可。
- **埋め込み= `amazon.nova-2-multimodal-embeddings-v1:0`**、**同期InvokeModelで動く**（モデルカードの「Invoke非対応」表記は**誤り**＝実機で確認）。次元=1024（TF変数 `embedding_dimension`）。DDBには **JSON文字列**で格納（U3でパースして使う）。
- **教訓: モデルの可用性/APIサポートはモデルカードを鵜呑みにせず、実 InvokeModel で確認すること。**
- **ADR-002（検索方式）= Nova埋め込み＋ブラウザ内コサイン総当たり**（小規模ゆえベクトルDB不要）。
- 全モデルID/Bedrockリージョン/次元は **TF変数**（`terraform/variables.tf`）で差し替え可。
- **Lambda依存同梱（#30）**：Node22ランタイムのSDK同梱は AWS保証外 → `upload`/`image-enrich` 等は `package.json`＋`package-lock.json`＋`terraform_data` の `npm ci` で同梱。**apply実行ホストに node/npm 必須**（CIランナーには両方あり）。
- **★ デプロイは CI 正本（2026-07-02〜）**：terraform の apply は **GitHub Actions（OIDC鍵レス）** が main への push で実行。**ローカル（特にMac）で `terraform apply` はしない。** 理由：重い4関数（upload/image-enrich/memos/query_embed）は `archive_file` が node_modules込みで zip 化するため、macOSビルドと Linux(CI)ビルドで `source_code_hash` が食い違う。CI同士は決定的で安定だが、**Mac のローカル `plan` はこの4件を常に「変更あり」と表示する＝正常・無視してよい**。編集/ビルド/テストはどこでやってもよいが、反映は push→マージ経由。
- **AWS鍵の要否**：CI経由デプロイは鍵不要（OIDC）。ただし**コンテナ/ローカルから直接 `aws` CLI や スクリプト（バックフィル等）を叩く場合は認証が必要** → `aws sso login --profile dev`（SSOトークンは数分〜数日で失効）。「直接AWSを触る操作」を無くしたければ運用ジョブをワークフロー化（§6-6）。
- **terraform state は S3 backend**（`sketch-stacker-tfstate-791464527050`・バージョニング＋ネイティブロック）。ローカルの `terraform/terraform.tfstate` は移行済みの旧コピー（gitignore・使わない）。

## 6. 残作業
Phase 1（U1〜U4＋バックフィル）完了。インフラ運用刷新（#41/#42）完了。残りは以下:
1. **ADR-005 のオーナー批准**：意味検索 `POST /search` を**オーナー限定（案A・実装済）**のままにするか、公開（案B・要レート制限）にするか。公開化するなら method の authorizer を外す1行＋別ADRでレート制限。
2. **（軽微）enrich未了7件**：`autoTags` 無しのDDBレコード7件。§末尾のバックフィル手順で解消可（要AWS認証・少額）。
3. **（任意・軽微）** DDBゴーストレコード（S3に実体なし・過去削除分）があれば掃除。images.json に出ないので表示・検索影響なし。
4. **次フェーズ = Phase 2（リファレンス写真管理）**：未着手。issue #21 の構想。新機能なので Inception（要件ヒアリング）から。
5. **（任意）OIDCロールの権限を permissions boundary で締める**：現状 `iam:*` を含む（terraform が IAM を管理するため必要）。信頼先は当repo main+PR に限定済みだが、エスカレーション余地を塞ぐなら boundary を追加。
6. **（任意）運用ジョブのワークフロー化**：バックフィル / `register-orphan-images` / lambda invoke / images.json 再生成 を `workflow_dispatch` 化すれば、スマホからボタン起動で CI が鍵レス実行（＝直接 `aws` CLI を叩く場面を無くせる）。

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
- **デプロイ（terraform apply）= CI（GitHub Actions・OIDC鍵レス）**：main への push（＝PRマージ）で自動実行。人手 apply は不要。
- **オーナーのみ**：PRマージ（＝デプロイ承認）、Anthropic用途フォーム提出、バックフィル等の課金を伴う直接実行の承認、`aws sso login`（直接AWSを触る作業時）。
- **エージェント**：設計・実装・PR作成・CIの `plan` 確認・実機検証（SSO有効時）。main 直pushしない・ローカル apply しない。

## 8. 動作確認の要点（apply後）
- enrich直接: `aws lambda invoke --function-name WIPUploader-ImageEnrichFunction --payload '{"imageId":"<key>"}' ...`
- DDB確認: `aws dynamodb get-item --table-name WIPUploader-ImageMetadata --key '{"imageId":{"S":"<key>"}}'` → `embedding`(JSON文字列)/`autoTags`(SS)/`enrichedAt` を確認
- 全文手順はセッション履歴の「apply手順 STEP0〜8」を参照。

## 9. 全体ロードマップ（issue/PR 対応・done/todo 一覧）
既存の全 issue / PR を棚卸しした現況（2026-07-03）。

### ✅ 完了（マージ / クローズ済）
| 領域 | 内容 | issue / PR |
|---|---|---|
| 基盤移行 | CloudFormation → Terraform 移行 | #10 / PR多数（初期） |
| 開発プロセス | AI-DLC ワークフロー導入 | #22,#23 / PR #23,#27 |
| セキュリティ堅牢化 | 認証情報ログ出力/権限共有/ワイルドカードARN/source_arn/APIログ/アップロード検証/tfvars gitignore | #14〜#20 / PR #24,#25,#26 |
| メタ基盤(U1) | DynamoDB 導入（=#11 の実質的な解） | PR #28 |
| 自動タグ＋埋め込み(U2) | Nova Lite タグ＋Nova 埋め込み・非同期enrich | PR #29,#30,#31,#35,#39 |
| タグ絞り込み(U3a) | フロントのタグフィルタ | PR #32 |
| 意味検索(U3b) | query-embed Lambda＋`POST /search`＋ブラウザ内コサイン | PR #34 |
| メモ編集＋非公開API(U4) | memos Lambda＋`GET/PUT /memos`＋管理UI・デフォルト非公開 | PR #36 |
| バックフィル/修正 | 収束スキャン・孤立画像登録・viewer混入除去 | PR #37,#38,#40 |
| MCPセットアップ | MCPサーバ導入 | #2 |
| 画像管理の軽量方式検討 | DynamoDB 方式に収束（役目終了） | #12 |
| **インフラ運用刷新（今回）** | **S3 backend 化 / OIDC 鍵レス CI 化** | **#41,#42** |

### 🔜 やりたいこと（open issue）
| 優先 | 内容 | issue | メモ |
|---|---|---|---|
| 高(メタ) | ロードマップ正典 / オンボーディング入口 | #21,#22 | 常時参照。クローズしない |
| 高 | ADR-005 批准（検索=オーナー限定 のまま or 公開） | — | §6-1。オーナー判断待ち |
| 中 | **Phase 2：リファレンス写真管理** | #21(Phase2) | 未着手・要 Inception（撮影メモ紐付け・絵↔写真の視覚類似サジェスト） |
| 低 | Processing/P5.js 作品対応（動画/GIF/インタラクティブ表示） | #13 | 表示層の拡張。Phase 1 とは独立 |
| 低 | 3D 積み上げビジュアル（調査→実装→通常ビュー切替） | #7,#8,#9 | 表現系。優先度低め |
| 低 | ランダム画像ピックアップ | #5,#6 | 小機能 |
| 低 | マルチエージェント実行機能 | #3,#4 | 実験的 |
| 低 | MCPサーバ選定/ブラウザ操作 調査 | #1 | #2 で一部着手済 |

### 🧹 棚卸しメモ（クローズ候補・要オーナー判断）
- **#11（images.json→DB移行検討）**：U1 の DynamoDB 導入で**実質達成済み**。クローズ候補。
- **#1（MCP調査）**：#2 で着手済み。現状のスコープと照らして要否を判断。
- 旧構想 #3〜#9,#13 は Phase 1（制作ループ支援）確定前のアイデア。#21 のビジョンと突き合わせ、活かす/畳むを仕分けると open issue が締まる。
