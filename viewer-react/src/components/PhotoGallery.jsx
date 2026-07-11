import { useState, useEffect, useCallback } from 'react';
import Masonry from 'react-masonry-css';
import Modal from './Modal';

// U-P1: リファレンス写真ビュー（管理モード限定）。
// GET /photos（Basic認証）で一覧＋期限付き presigned URL を取得して表示する。
// 写真は常に非公開（公開CDNには存在しない）。撮影メモの編集・削除・モノクロ表示（バリュー確認の
// 最小導線 = check-value 思想）を備える。
const PhotoGallery = ({ admin, apiBase }) => {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mono, setMono] = useState(false); // モノクロ表示（バリュー確認用）
  const [modal, setModal] = useState(null); // {url, memo}
  const [memoEditor, setMemoEditor] = useState(null); // {photoId, memo, saving, error}

  const authHeader = 'Basic ' + btoa(`${admin.username}:${admin.password}`);

  const fetchPhotos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/photos`, { headers: { 'Authorization': authHeader } });
      if (res.status === 401 || res.status === 403) throw new Error('認証に失敗しました');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPhotos(Array.isArray(data.photos) ? data.photos : []);
    } catch (err) {
      console.error('写真一覧の取得失敗', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, admin]);

  useEffect(() => { fetchPhotos(); }, [fetchPhotos]);

  const handleDelete = async (photoId) => {
    if (!window.confirm(`この写真を削除しますか？\n${photoId}\n\n（バージョニングにより一定期間は復旧可能です）`)) return;
    try {
      const res = await fetch(`${apiBase}/photos/${encodeURIComponent(photoId)}`, {
        method: 'DELETE',
        headers: { 'Authorization': authHeader },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPhotos(prev => prev.filter(p => p.photoId !== photoId));
    } catch (err) {
      alert(`削除に失敗しました: ${err.message}`);
    }
  };

  const saveMemo = async () => {
    if (!memoEditor) return;
    setMemoEditor(m => ({ ...m, saving: true, error: null }));
    try {
      const res = await fetch(`${apiBase}/photos/${encodeURIComponent(memoEditor.photoId)}`, {
        method: 'PUT',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ memo: memoEditor.memo }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved = memoEditor;
      setPhotos(prev => prev.map(p => p.photoId === saved.photoId ? { ...p, memo: saved.memo } : p));
      setMemoEditor(null);
    } catch (err) {
      setMemoEditor(m => m && ({ ...m, saving: false, error: `保存失敗: ${err.message}` }));
    }
  };

  const dateString = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }) + ' ' +
      d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const btnStyle = {
    padding: '6px 12px', background: '#333', color: '#fff', border: 'none',
    borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem',
  };

  const breakpointColumns = { default: 6, 1200: 5, 900: 4, 700: 3, 500: 2, 350: 1 };

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.9rem', color: '#666' }}>
          リファレンス写真（非公開・{photos.length}枚）
        </span>
        <button style={{ ...btnStyle, background: mono ? '#2c3e50' : '#888' }} onClick={() => setMono(m => !m)}>
          {mono ? 'カラーに戻す' : 'モノクロ表示（バリュー確認）'}
        </button>
        <button style={btnStyle} onClick={fetchPhotos}>再読込</button>
      </div>

      {loading && <div>Loading...</div>}
      {error && <div style={{ color: '#c0392b' }}>Error: {error}</div>}
      {!loading && !error && photos.length === 0 && (
        <div style={{ color: '#666', margin: '20px 0' }}>
          写真はまだありません。iOSショートカット（POST /photos）でアップロードしてください。
        </div>
      )}

      <Masonry breakpointCols={breakpointColumns} className="gallery" columnClassName="gallery-column">
        {photos.map((p) => (
          <div className="gallery-item" key={p.photoId}>
            <img
              src={p.url}
              alt={p.photoId}
              loading="lazy"
              style={mono ? { filter: 'grayscale(1)' } : undefined}
              onClick={() => setModal({ url: p.url, memo: p.memo })}
            />
            <button
              className="ctrl-btn"
              onClick={() => handleDelete(p.photoId)}
              style={{ position: 'absolute', top: 4, left: 4, background: '#c0392b', color: '#fff', zIndex: 2, opacity: 1, visibility: 'visible' }}
            >
              削除
            </button>
            <button
              className="ctrl-btn"
              onClick={() => setMemoEditor({ photoId: p.photoId, memo: p.memo || '', saving: false, error: null })}
              style={{ position: 'absolute', top: 4, left: 54, background: '#2c3e50', color: '#fff', zIndex: 2, opacity: 1, visibility: 'visible' }}
            >
              メモ
            </button>
            {p.memo && (
              <div className="memo-preview" onClick={() => setModal({ url: p.url, memo: p.memo })}>
                <span className="memo-lock" title="非公開">🔒</span>
                {p.memo}
              </div>
            )}
            {p.uploadedAt && <span className="date-label">{dateString(p.uploadedAt)}</span>}
          </div>
        ))}
      </Masonry>

      <Modal
        isOpen={!!modal}
        imageUrl={modal ? modal.url : ''}
        memo={modal ? modal.memo : ''}
        isPrivate={true}
        onClose={() => setModal(null)}
      />

      {/* 撮影メモ編集（絵のメモエディタと同型・公開トグルは無い=写真は常に非公開） */}
      {memoEditor && (
        <div
          onClick={() => !memoEditor.saving && setMemoEditor(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 8, padding: 20, width: 'min(520px, 92vw)', boxShadow: '0 8px 30px rgba(0,0,0,0.3)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <strong>撮影メモ編集</strong>
              <span style={{ fontSize: '0.75rem', color: '#888' }}>{memoEditor.photoId}</span>
            </div>
            <textarea
              placeholder="撮影時の気づき（光・色・なぜ撮ったか など）"
              value={memoEditor.memo}
              disabled={memoEditor.saving}
              onChange={e => setMemoEditor(m => ({ ...m, memo: e.target.value }))}
              style={{ width: '100%', minHeight: 110, padding: 8, border: '1px solid #ccc', borderRadius: 4, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 12 }}
            />
            {memoEditor.error && <div style={{ color: '#c0392b', fontSize: '0.85rem', marginBottom: 8 }}>{memoEditor.error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button style={btnStyle} onClick={() => setMemoEditor(null)} disabled={memoEditor.saving}>キャンセル</button>
              <button style={btnStyle} onClick={saveMemo} disabled={memoEditor.saving}>
                {memoEditor.saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default PhotoGallery;
