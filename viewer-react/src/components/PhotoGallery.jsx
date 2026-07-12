import { useState, useEffect, useCallback } from 'react';
import Masonry from 'react-masonry-css';
import Modal from './Modal';

// U-P1: リファレンス写真ビュー（管理モード限定）。
// GET /photos（Basic認証）で一覧＋期限付き presigned URL を取得して表示する。
// 写真は常に非公開（公開CDNには存在しない）。撮影メモの編集・削除に加え、
// バリュー確認は自作 check-value-app に presigned URL を ?img= で渡して別タブで開く。
const CHECK_VALUE_APP = 'https://odayakalife.dev/check-value-app/';

const PhotoGallery = ({ admin, apiBase, baseUrl, embedUrl }) => {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null); // {url, memo}
  const [memoEditor, setMemoEditor] = useState(null); // {photoId, memo, saving, error}
  // U-P2 類似サジェスト: {photoId, items:[{imageId,score}], loading, error} | null
  const [suggest, setSuggest] = useState(null);
  const [embeddingsCache, setEmbeddingsCache] = useState(null); // 絵側ベクトル(公開embeddings.json)

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

  // ---- U-P2: 絵↔写真の類似サジェスト＋手動紐づけ ----------------------------------

  // コサイン類似度（ImageGalleryの意味検索と同じ・ADR-002のブラウザ内総当たり）
  const cosine = (a, b) => {
    let dot = 0, na = 0, nb = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
  };

  const loadEmbeddings = async () => {
    if (embeddingsCache) return embeddingsCache;
    const res = await fetch(embedUrl, { method: 'GET', mode: 'cors', credentials: 'omit', headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`embeddings.json HTTP ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data.filter(e => e && e.imageId && Array.isArray(e.embedding)) : [];
    setEmbeddingsCache(list);
    return list;
  };

  const SUGGEST_LIMIT = 12;

  // 「似た絵」: この写真のベクトルと全ての絵のベクトルを比較して上位を出す
  const openSuggest = async (p) => {
    setSuggest({ photoId: p.photoId, items: [], loading: true, error: null });
    try {
      if (!p.embedding) throw new Error('この写真の埋め込みが未生成です（アップロード直後は数十秒待って「再読込」）');
      const list = await loadEmbeddings();
      const items = list
        .map(e => ({ imageId: e.imageId, score: cosine(p.embedding, e.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, SUGGEST_LIMIT);
      setSuggest(s => s && s.photoId === p.photoId ? { ...s, items, loading: false } : s);
    } catch (err) {
      setSuggest(s => s && s.photoId === p.photoId ? { ...s, loading: false, error: err.message } : s);
    }
  };

  // 紐づけ/解除（PUT /photos/{key}）。成功したらローカルの linkedImages を更新
  const toggleLink = async (photoId, imageId, currentlyLinked) => {
    try {
      const res = await fetch(`${apiBase}/photos/${encodeURIComponent(photoId)}`, {
        method: 'PUT',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify(currentlyLinked ? { linkImageRemove: imageId } : { linkImageAdd: imageId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPhotos(prev => prev.map(p => {
        if (p.photoId !== photoId) return p;
        const set = new Set(p.linkedImages || []);
        if (currentlyLinked) set.delete(imageId); else set.add(imageId);
        return { ...p, linkedImages: [...set] };
      }));
    } catch (err) {
      alert(`紐づけの更新に失敗しました: ${err.message}`);
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
              // crossOrigin必須: これ無しで読むとCORSヘッダ無しの応答がブラウザにキャッシュされ、
              // 後から check-value-app が同じURLを crossOrigin で読む際にキャッシュ汚染で失敗する
              crossOrigin="anonymous"
              onClick={() => setModal({ url: p.url, memo: p.memo })}
            />
            {/* 操作ボタン: 固定座標だと細いタイルで重なるため、折り返すflex行に載せる */}
            <div style={{ position: 'absolute', top: 4, left: 4, right: 4, display: 'flex', gap: 4, flexWrap: 'wrap', zIndex: 2 }}>
              <button
                className="ctrl-btn"
                onClick={() => handleDelete(p.photoId)}
                style={{ position: 'static', background: '#c0392b', color: '#fff', opacity: 1, visibility: 'visible' }}
              >
                削除
              </button>
              <button
                className="ctrl-btn"
                onClick={() => setMemoEditor({ photoId: p.photoId, memo: p.memo || '', saving: false, error: null })}
                style={{ position: 'static', background: '#2c3e50', color: '#fff', opacity: 1, visibility: 'visible' }}
              >
                メモ
              </button>
              <button
                className="ctrl-btn"
                onClick={() => window.open(`${CHECK_VALUE_APP}?img=${encodeURIComponent(p.url)}`, '_blank', 'noopener')}
                title="check-value-app でバリュー確認（グレースケール/Notan/ポスタリゼーション）"
                style={{ position: 'static', background: '#7d3c98', color: '#fff', opacity: 1, visibility: 'visible' }}
              >
                Value
              </button>
              <button
                className="ctrl-btn"
                onClick={() => openSuggest(p)}
                title="この写真に視覚的に似た絵を探して紐づける"
                style={{ position: 'static', background: '#1a5276', color: '#fff', opacity: 1, visibility: 'visible' }}
              >
                似た絵
              </button>
            </div>
            {p.memo && (
              <div className="memo-preview" onClick={() => setModal({ url: p.url, memo: p.memo })}>
                <span className="memo-lock" title="非公開">🔒</span>
                {p.memo}
              </div>
            )}
            {/* 紐づけ済みの絵（公開CDNのサムネイル）。クリックで絵を別タブ表示 */}
            {(p.linkedImages || []).length > 0 && (
              <div style={{ display: 'flex', gap: 4, padding: '4px 8px 0', flexWrap: 'wrap' }}>
                {p.linkedImages.map(id => (
                  <img
                    key={id}
                    src={baseUrl + id}
                    alt={id}
                    title={`紐づけ済み: ${id}`}
                    onClick={(e) => { e.stopPropagation(); window.open(baseUrl + id, '_blank', 'noopener'); }}
                    style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, border: '1px solid #ddd', cursor: 'pointer' }}
                  />
                ))}
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

      {/* U-P2 類似サジェストパネル: 似ている絵の候補を出し、クリックで紐づけ/解除 */}
      {suggest && (
        <div
          onClick={() => setSuggest(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 8, padding: 20, width: 'min(720px, 94vw)', maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 8px 30px rgba(0,0,0,0.3)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <strong>この写真に似た絵（候補をタップで紐づけ⇄解除）</strong>
              <button style={btnStyle} onClick={() => setSuggest(null)}>閉じる</button>
            </div>
            {suggest.loading && <div>類似度を計算中…</div>}
            {suggest.error && <div style={{ color: '#c0392b' }}>{suggest.error}</div>}
            {!suggest.loading && !suggest.error && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                {suggest.items.map(({ imageId, score }) => {
                  const photo = photos.find(p => p.photoId === suggest.photoId);
                  const linked = !!(photo && (photo.linkedImages || []).includes(imageId));
                  return (
                    <div
                      key={imageId}
                      onClick={() => toggleLink(suggest.photoId, imageId, linked)}
                      style={{ cursor: 'pointer', border: linked ? '3px solid #2d7' : '1px solid #ddd', borderRadius: 6, overflow: 'hidden', position: 'relative' }}
                      title={linked ? 'クリックで紐づけ解除' : 'クリックで紐づけ'}
                    >
                      <img src={baseUrl + imageId} alt={imageId} loading="lazy" style={{ width: '100%', display: 'block' }} />
                      <div style={{ fontSize: '0.7rem', padding: '2px 6px', display: 'flex', justifyContent: 'space-between', background: linked ? '#e8f8ef' : '#fafafa' }}>
                        <span>{linked ? '✓ 紐づけ済み' : `類似 ${(score * 100).toFixed(0)}%`}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

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
