// アクセス分析(PostHog)。目的: どの絵がタップ/Open/CopyされたかをPostHogに送って集計する。
// issue #59 参照。
//
// POSTHOG_KEY はPostHogの「プロジェクトAPIキー」。フロントに埋め込む前提の公開トークンで
// (全訪問者のJSに露出する種類のもの)、イベント送信にしか使えない。リポジトリに直書きでよい。
// 空文字の間は計測は完全に無効(何も送らない・posthogを初期化すらしない)。
import posthog from 'posthog-js';

const POSTHOG_KEY = 'phc_vdmnmoe8TgBCni3MaDEZGfwfeV8Z5nqpN6rcuEa8k6UV'; // オーナーのプロジェクトAPIキー(公開トークン・issue #59)
const POSTHOG_HOST = 'https://us.i.posthog.com'; // US Cloudの既定ホスト

let enabled = false;

// オーナー除外の判定は「今開いているURL」だけで行う【ステートレス方式】。
// ?admin / ?notrack / #k= のいずれかが付いていれば、そのページロードでは計測しない。
// localStorage等にフラグは一切持たない — 「このブラウザは除外済みだっけ？」という
// 見えない状態管理をオーナーに強いないため(オーナー裁定 2026-07-19)。
// 運用: 自分は常にブックマーク(管理URL or ?notrack)から開く。パラメータ無しで開けば計上される。
const isOwnerUrl = () => {
  const p = new URLSearchParams(window.location.search);
  return p.has('admin') || p.has('notrack') || window.location.hash.startsWith('#k=');
};

/**
 * アプリ起動時に1回呼ぶ。キー未設定なら何もしない(=計測オフ)。
 * オーナー除外URLなら posthog を初期化すらしない = このページロードからは
 * $pageview 含め1件も送信されない(SPAなので以降のタップ等も全て同一ロード内=送信されない)。
 */
export function initAnalytics() {
  if (!POSTHOG_KEY) return;
  if (isOwnerUrl()) {
    console.info('[analytics] オーナーURLのためこのページロードは計測されません');
    return;
  }
  // init の書式は公式docsの標準形(https://posthog.com/docs/libraries/js)
  posthog.init(POSTHOG_KEY, { api_host: POSTHOG_HOST, defaults: '2025-05-24' });
  enabled = true;
}

/** カスタムイベント送信。未初期化なら黙って無視(計測がアプリ動作を壊さないこと最優先)。 */
export function captureEvent(name, props) {
  if (!enabled) return;
  try {
    posthog.capture(name, props);
  } catch (e) {
    // 計測失敗はアプリの動作に影響させない
    console.warn('analytics capture failed', e);
  }
}
