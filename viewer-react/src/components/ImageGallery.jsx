import { useState, useEffect } from 'react';
import ImageItem from './ImageItem';
import Modal from './Modal';
import ContributionCalendar from './ContributionCalendar';
import Masonry from 'react-masonry-css';

const ImageGallery = () => {
  const [images, setImages] = useState([]);
  const [visibleCount, setVisibleCount] = useState(20);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalImageUrl, setModalImageUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // U3a タグ絞り込み: metadata.json(U1射影) の autoTags を imageId->tags で保持。
  const [tagsById, setTagsById] = useState({});
  const [selectedTags, setSelectedTags] = useState([]); // AND 絞り込み（選択タグを全て含む画像のみ）
  // 管理モード: 認証情報はメモリ上のみ保持（localStorageには残さない＝再読込で消える）
  const [admin, setAdmin] = useState(null);
  const [adminForm, setAdminForm] = useState({ open: false, username: '', password: '' });
  // 管理UIはURLに ?admin が付いている時だけ表示（一般訪問者には一切出さない）。実際のガードはAPI側のBasic認証。
  const [adminUnlocked] = useState(() => new URLSearchParams(window.location.search).has('admin'));
  // U3b 意味検索（オーナー限定=ADR-005）: 検索語/結果/状態。結果は imageId のランキング配列（null=非検索）。
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  // 画像側ベクトル(embeddings.json)は重いので検索時に一度だけ遅延ロードしてメモリにキャッシュ。
  const [embeddingsCache, setEmbeddingsCache] = useState(null);

  // 設定
  const BASE_URL = "https://d3a21s3joww9j4.cloudfront.net/";
  const JSON_URL = "https://d3a21s3joww9j4.cloudfront.net/viewer/images.json";
  const META_URL = "https://d3a21s3joww9j4.cloudfront.net/viewer/metadata.json";
  const EMBED_URL = "https://d3a21s3joww9j4.cloudfront.net/viewer/embeddings.json";
  const API_BASE = "https://3p4utkstnb.execute-api.ap-northeast-1.amazonaws.com/prod";
  // viewer/ 配下は運用ファイル(images.json / metadata.json / embeddings.json / index.html 等)であって
  // 作品画像ではない。接頭辞で一括除外する（完全一致だと新しい viewer/ 成果物が漏れてタイル表示されてしまう）。
  const EXCLUDE_PREFIX = "viewer/";
  const INITIAL_COUNT = 20;
  const SEARCH_RESULT_LIMIT = 60; // 意味検索の上位表示件数

  useEffect(() => {
    fetchImages();
  }, []);

  // タグ選択が変わったら表示件数をリセット（先頭から見せ直す）
  useEffect(() => {
    setVisibleCount(INITIAL_COUNT);
  }, [selectedTags]);

  const fetchImages = async () => {
    try {
      setLoading(true);
      // 画像一覧(images.json)とメタデータ(metadata.json=autoTags)を並行取得。
      // metadata.json はU1射影。未生成/失敗でもギャラリーは画像一覧だけで成立させる。
      const [response, metaRes] = await Promise.all([
        fetch(JSON_URL, { method: 'GET', mode: 'cors', credentials: 'omit', headers: { 'Accept': 'application/json' } }),
        fetch(META_URL, { method: 'GET', mode: 'cors', credentials: 'omit', headers: { 'Accept': 'application/json' } }).catch(() => null),
      ]);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const files = await response.json();

      // フィルタリングとソート
      const filteredFiles = files
        .filter(name => typeof name === 'string' && !name.startsWith(EXCLUDE_PREFIX))
        .sort((a, b) => b.localeCompare(a)); // 降順（新しい順）

      // metadata.json から imageId -> autoTags を構築（取得できた場合のみ）
      if (metaRes && metaRes.ok) {
        try {
          const meta = await metaRes.json();
          const map = {};
          for (const m of Array.isArray(meta) ? meta : []) {
            if (m && m.imageId && Array.isArray(m.autoTags) && m.autoTags.length) {
              map[m.imageId] = m.autoTags;
            }
          }
          setTagsById(map);
        } catch (e) {
          console.warn('metadata.json の解析に失敗（タグ絞り込みなしで継続）', e);
        }
      }

      setImages(filteredFiles);
      setVisibleCount(INITIAL_COUNT);
    } catch (err) {
      console.error("画像リスト取得失敗", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleTag = (tag) => {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const handleLoadMore = () => {
    setVisibleCount(c => c + INITIAL_COUNT);
  };

  const handleImageClick = (imageUrl) => {
    setModalImageUrl(imageUrl);
    setModalOpen(true);
  };

  const handleModalClose = () => {
    setModalOpen(false);
    setModalImageUrl('');
  };

  // 管理モードを有効化（認証情報をメモリに保持。ページを閉じれば消える）
  const enableAdmin = (e) => {
    e.preventDefault();
    if (!adminForm.username || !adminForm.password) return;
    setAdmin({ username: adminForm.username, password: adminForm.password });
    setAdminForm({ open: false, username: '', password: '' });
  };

  const disableAdmin = () => setAdmin(null);

  // 画像を削除（Basic認証付きで DELETE API を呼ぶ）
  const handleDelete = async (imageName) => {
    if (!admin) return;
    if (!window.confirm(`この画像を削除しますか？\n${imageName}\n\n（バージョニングにより一定期間は復旧可能です）`)) return;
    try {
      const res = await fetch(`${API_BASE}/images/${encodeURIComponent(imageName)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Basic ' + btoa(`${admin.username}:${admin.password}`),
        },
      });
      if (res.status === 401 || res.status === 403) {
        alert('認証に失敗しました。ユーザー名・パスワードを確認してください。');
        return;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      // 成功したらUIから即座に除去
      setImages(prev => prev.filter(n => n !== imageName));
    } catch (err) {
      console.error("削除失敗", err);
      alert(`削除に失敗しました: ${err.message}`);
    }
  };

  // 画像側ベクトル(embeddings.json)を取得（初回のみ。以後はキャッシュを返す）。
  const loadEmbeddings = async () => {
    if (embeddingsCache) return embeddingsCache;
    const res = await fetch(EMBED_URL, { method: 'GET', mode: 'cors', credentials: 'omit', headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`embeddings.json HTTP ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data.filter(e => e && e.imageId && Array.isArray(e.embedding)) : [];
    setEmbeddingsCache(list);
    return list;
  };

  // コサイン類似度（クエリベクトルと画像ベクトル）。
  const cosine = (a, b) => {
    let dot = 0, na = 0, nb = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
  };

  // U3b 意味検索: クエリを Bedrock(認証付きAPI)で埋め込み、ブラウザ内でコサイン総当たり→ランキング。
  const handleSearch = async (e) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (!q || !admin) return;
    setSearching(true);
    setSearchError(null);
    try {
      // 1) クエリ埋め込み（オーナー限定エンドポイント=Basic認証）
      const res = await fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${admin.username}:${admin.password}`),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q }),
      });
      if (res.status === 401 || res.status === 403) {
        setSearchError('認証に失敗しました。ユーザー名・パスワードを確認してください。');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { embedding } = await res.json();
      if (!Array.isArray(embedding)) throw new Error('クエリ埋め込みの形式が不正です');

      // 2) 画像ベクトルを遅延ロードし、表示中の画像に限ってコサインで順位付け
      const list = await loadEmbeddings();
      const present = new Set(images);
      const ranked = list
        .filter(e => present.has(e.imageId))
        .map(e => ({ imageId: e.imageId, score: cosine(embedding, e.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, SEARCH_RESULT_LIMIT)
        .map(r => r.imageId);
      setSearchResults(ranked);
    } catch (err) {
      console.error('検索失敗', err);
      setSearchError(`検索に失敗しました: ${err.message}`);
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchResults(null);
    setSearchInput('');
    setSearchError(null);
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>Error: {error}</div>;
  }

  // 選択タグ(AND)で絞り込み。選択が無ければ全件。
  const filteredImages = selectedTags.length === 0
    ? images
    : images.filter(name => {
        const tags = tagsById[name];
        return tags && selectedTags.every(t => tags.includes(t));
      });
  // 意味検索が有効なら、その類似度ランキング（既にソート済み・上位N件）を優先表示。
  // 非検索時は従来どおりタグ絞り込み＋Load More のページング。
  const searchActive = searchResults !== null;
  const displayedImages = searchActive ? searchResults : filteredImages.slice(0, visibleCount);
  const hasMoreImages = !searchActive && displayedImages.length < filteredImages.length;

  // タグチップ用: 出現頻度の高い順に上位を提示（多すぎる時の足切り）。選択中タグは常に含める。
  const TAG_CHIP_LIMIT = 40;
  const tagCounts = {};
  for (const name of images) {
    for (const t of tagsById[name] || []) tagCounts[t] = (tagCounts[t] || 0) + 1;
  }
  const topTags = Object.keys(tagCounts)
    .sort((a, b) => tagCounts[b] - tagCounts[a] || a.localeCompare(b))
    .slice(0, TAG_CHIP_LIMIT);
  const chipTags = Array.from(new Set([...selectedTags, ...topTags]));

  const breakpointColumns = {
    default: 6,
    1200: 5,
    900: 4,
    700: 3,
    500: 2,
    350: 1
  };

  // 管理バー用のボタンスタイル（画像オーバーレイ用 .ctrl-btn は非表示制御が入るため流用しない）
  const adminBtnStyle = {
    padding: '6px 12px',
    background: '#333',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: '0.85rem'
  };

  return (
    <>
      {/* 管理UI: URLに ?admin が付いている時だけ表示。一般訪問者には何も出さない */}
      {adminUnlocked && (
      <div className="admin-bar" style={{ margin: '8px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {!admin && !adminForm.open && (
          <button style={adminBtnStyle} onClick={() => setAdminForm({ ...adminForm, open: true })}>
            管理モード
          </button>
        )}
        {!admin && adminForm.open && (
          <form onSubmit={enableAdmin} style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
            <input
              placeholder="ユーザー名"
              autoComplete="username"
              value={adminForm.username}
              onChange={e => setAdminForm({ ...adminForm, username: e.target.value })}
            />
            <input
              type="password"
              placeholder="パスワード"
              autoComplete="current-password"
              value={adminForm.password}
              onChange={e => setAdminForm({ ...adminForm, password: e.target.value })}
            />
            <button style={adminBtnStyle} type="submit">有効化</button>
            <button style={adminBtnStyle} type="button" onClick={() => setAdminForm({ open: false, username: '', password: '' })}>
              キャンセル
            </button>
          </form>
        )}
        {admin && (
          <>
            <span style={{ color: '#c0392b', fontWeight: 'bold' }}>● 管理モード（削除可能）</span>
            <button style={adminBtnStyle} onClick={disableAdmin}>解除</button>
          </>
        )}
      </div>
      )}

      {/* U3b 意味検索: オーナー限定（クエリ埋め込みAPIがBasic認証必須=ADR-005）。管理モード時のみ表示。 */}
      {admin && (
        <form onSubmit={handleSearch} className="semantic-search" style={{ display: 'flex', gap: 6, margin: '8px 0', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            placeholder="意味で検索（例: 山並みの風景 / セーラー服の少女）"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            style={{ flex: '1 1 260px', minWidth: 200, padding: '6px 10px', border: '1px solid #ccc', borderRadius: 4 }}
          />
          <button type="submit" style={adminBtnStyle} disabled={searching || !searchInput.trim()}>
            {searching ? '検索中…' : '意味検索'}
          </button>
          {searchActive && (
            <button type="button" style={adminBtnStyle} onClick={clearSearch}>
              検索クリア（{searchResults.length}件）
            </button>
          )}
          {searchError && <span style={{ color: '#c0392b', fontSize: '0.85rem' }}>{searchError}</span>}
        </form>
      )}

      {/* Contribution Calendar */}
      <ContributionCalendar images={images} />

      {/* U3a タグ絞り込み: 自動タグ(autoTags)のチップ。クリックでAND絞り込み。タグが無ければ非表示。
          意味検索（U3b）が有効な間は二重フィルタの混乱を避けるため非表示。 */}
      {!searchActive && chipTags.length > 0 && (
        <div className="tag-filter" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '10px 0', alignItems: 'center' }}>
          {selectedTags.length > 0 && (
            <button
              onClick={() => setSelectedTags([])}
              style={{ padding: '4px 10px', borderRadius: 14, border: '1px solid #ccc', background: '#fff', cursor: 'pointer', fontSize: '0.8rem' }}
            >
              クリア（{filteredImages.length}件）
            </button>
          )}
          {chipTags.map(tag => {
            const on = selectedTags.includes(tag);
            return (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                style={{
                  padding: '4px 10px', borderRadius: 14, cursor: 'pointer', fontSize: '0.8rem',
                  border: on ? '1px solid #2d7' : '1px solid #ddd',
                  background: on ? '#2d7' : '#f5f5f5',
                  color: on ? '#fff' : '#333',
                }}
              >
                {tag}{tagCounts[tag] ? ` (${tagCounts[tag]})` : ''}
              </button>
            );
          })}
        </div>
      )}

      <Masonry
        breakpointCols={breakpointColumns}
        className="gallery"
        columnClassName="gallery-column"
      >
        {displayedImages.map((imageName, index) => (
          <ImageItem
            key={`${imageName}-${index}`}
            imageName={imageName}
            baseUrl={BASE_URL}
            onImageClick={handleImageClick}
            adminMode={!!admin}
            onDelete={handleDelete}
          />
        ))}
      </Masonry>

      {hasMoreImages && (
        <button
          className="load-more"
          onClick={handleLoadMore}
        >
          Load More ({Math.min(INITIAL_COUNT, filteredImages.length - displayedImages.length)} more)
        </button>
      )}

      <Modal
        isOpen={modalOpen}
        imageUrl={modalImageUrl}
        onClose={handleModalClose}
      />
    </>
  );
};

export default ImageGallery;
