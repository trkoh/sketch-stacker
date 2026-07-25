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

/** アプリ起動時に1回呼ぶ。キー未設定なら何もしない(=計測オフ)。 */
export function initAnalytics() {
  if (!POSTHOG_KEY) return;
  // init の書式は公式docsの標準形(https://posthog.com/docs/libraries/js)
  posthog.init(POSTHOG_KEY, { api_host: POSTHOG_HOST, defaults: '2025-05-24' });
  enabled = true;
}

/**
 * このブラウザを計測対象から永続的に除外する(オーナー自身のアクセス除外用)。
 * opt-out状態は localStorage/cookie に保存され、以後このブラウザからは一切送信されない
 * (公式: https://posthog.com/docs/privacy/data-collection)。
 * 元に戻すにはブラウザのコンソールで localStorage.clear() するか、
 * 開発者ツールから posthog.opt_in_capturing() を呼ぶ。
 */
export function optOutThisBrowser() {
  if (!POSTHOG_KEY) return;
  try {
    if (!posthog.has_opted_out_capturing()) {
      posthog.opt_out_capturing();
      console.info('[analytics] このブラウザは計測対象外になりました(オーナー除外)');
    }
  } catch (e) {
    console.warn('analytics opt-out failed', e);
  }
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
