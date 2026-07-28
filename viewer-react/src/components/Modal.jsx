import { useEffect, useRef } from 'react';
import MemoText from './MemoText';

const CHECK_VALUE_APP = 'https://odayakalife.dev/check-value-app/';

// 拡大モーダル。前後ナビ(onPrev/onNext)は ←→キー・左右ボタン・横スワイプの3経路。Escで閉じる。
// refPhotoUrls: 紐づけ済み参照写真 [{url, memo}] (旧形式のURL文字列配列も受ける)。
// onRefPhotoClick があればページ内で拡大(呼び出し側が別モーダルを開く)、無ければ別タブ。
// valueUrl を渡すと「Value」ボタン(check-value-appを別タブで開く)を表示する。
const Modal = ({ isOpen, imageUrl, memo, isPrivate, refPhotoUrls = [], onRefPhotoClick, valueUrl, onClose, onPrev, onNext, hasPrev, hasNext }) => {
  const touchStartX = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasPrev && onPrev) onPrev();
      else if (e.key === 'ArrowRight' && hasNext && onNext) onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, onPrev, onNext, hasPrev, hasNext]);

  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleTouchStart = (e) => {
    touchStartX.current = e.touches && e.touches[0] ? e.touches[0].clientX : null;
  };
  const handleTouchEnd = (e) => {
    if (touchStartX.current == null) return;
    const endX = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : null;
    if (endX == null) return;
    const dx = endX - touchStartX.current;
    touchStartX.current = null;
    // 60px以上の横スワイプでページ送り(右スワイプ=前へ / 左スワイプ=次へ)
    if (dx > 60 && hasPrev && onPrev) onPrev();
    else if (dx < -60 && hasNext && onNext) onNext();
  };

  const navBtnStyle = (side) => ({
    position: 'fixed',
    top: '50%',
    [side]: 10,
    transform: 'translateY(-50%)',
    zIndex: 1001,
    background: 'rgba(0,0,0,0.45)',
    color: '#fff',
    border: 'none',
    borderRadius: '50%',
    width: 44,
    height: 44,
    fontSize: '1.4rem',
    cursor: 'pointer',
    lineHeight: 1,
  });

  return (
    <div
      className={`modal ${isOpen ? 'show' : ''}`}
      onClick={handleBackdropClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {hasPrev && onPrev && (
        <button style={navBtnStyle('left')} onClick={(e) => { e.stopPropagation(); onPrev(); }} title="前の絵（←キー / 右スワイプ）">
          ‹
        </button>
      )}
      {hasNext && onNext && (
        <button style={navBtnStyle('right')} onClick={(e) => { e.stopPropagation(); onNext(); }} title="次の絵（→キー / 左スワイプ）">
          ›
        </button>
      )}
      {valueUrl && (
        <button
          style={{
            position: 'fixed', top: 14, right: 14, zIndex: 1001,
            background: 'rgba(125, 60, 152, 0.9)', color: '#fff', border: 'none',
            borderRadius: 999, height: 34, padding: '0 16px', fontSize: '0.8rem', cursor: 'pointer',
          }}
          onClick={(e) => {
            e.stopPropagation();
            window.open(`${CHECK_VALUE_APP}?img=${encodeURIComponent(valueUrl)}`, '_blank', 'noopener');
          }}
          title="check-value-app でバリュー確認（グレースケール/Notan/ポスタリゼーション）"
        >
          Value
        </button>
      )}
      <div className="modal-body">
        {/* crossOrigin: 写真(presigned)のキャッシュをCORS付きで統一するため(check-value-app連携のキャッシュ汚染対策)。
            絵(CloudFront)側もCORSポリシー設定済みなので同一指定で問題ない */}
        <img src={imageUrl} alt="preview" crossOrigin="anonymous" />
        {/* U-P2: この絵に紐づくリファレンス写真（管理モード時のみ渡ってくる・非公開）。
            クリックはページ内拡大(onRefPhotoClick)。旧形式(URL文字列)は別タブフォールバック */}
        {refPhotoUrls.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {refPhotoUrls.map((r, i) => {
              const url = typeof r === 'string' ? r : r.url;
              return (
                <img
                  key={i}
                  src={url}
                  alt={`Reference photo ${i + 1}`}
                  loading="lazy"
                  crossOrigin="anonymous"
                  title="Linked reference photo (click to enlarge)"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onRefPhotoClick) onRefPhotoClick(typeof r === 'string' ? { url: r, memo: '' } : r);
                    else window.open(url, '_blank', 'noopener');
                  }}
                  style={{ height: 72, borderRadius: 6, border: '2px solid rgba(255,255,255,0.8)', cursor: 'pointer' }}
                />
              );
            })}
          </div>
        )}
        {memo && (
          <div className="modal-memo">
            {isPrivate && <div className="modal-memo-private">Private memo</div>}
            <MemoText text={memo} />
          </div>
        )}
      </div>
    </div>
  );
};

export default Modal;
