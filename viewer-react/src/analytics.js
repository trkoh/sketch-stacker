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

// オーナー除外フラグ。管理URL(?admin / #k=)で一度でも開いたブラウザに恒久的に立てる。
const OPTOUT_FLAG = 'sketchstacker_analytics_optout';

const isAdminUrl = () =>
  new URLSearchParams(window.location.search).has('admin') || window.location.hash.startsWith('#k=');

/**
 * アプリ起動時に1回呼ぶ。キー未設定なら何もしない(=計測オフ)。
 *
 * オーナー除外: posthog を初期化する「前に」管理URL判定と除外フラグを確認する。
 * フラグがある限り init 自体を行わないため、初回訪問時の $pageview を含めて
 * 1件も送信されない(初期化後に opt-out する方式だと初回1件が漏れる)。
 * 同じブラウザなら以後、公開ページを開いても計測されない。
 * 限界: 管理URLを開いたことのない別ブラウザ/別端末/シークレットウィンドウからは計測される。
 * 解除したい場合: コンソールで localStorage.removeItem('sketchstacker_analytics_optout')
 */
export function initAnalytics() {
  if (!POSTHOG_KEY) return;
  try {
    if (isAdminUrl()) localStorage.setItem(OPTOUT_FLAG, '1');
    if (localStorage.getItem(OPTOUT_FLAG)) {
      console.info('[analytics] オーナー端末のため計測は無効です');
      return;
    }
  } catch (e) {
    // localStorage が使えない環境(一部プライベートモード等)では判定不能→通常計測にフォールバック
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
