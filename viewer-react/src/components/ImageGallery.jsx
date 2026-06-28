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

  // 設定
  const BASE_URL = "https://d3a21s3joww9j4.cloudfront.net/";
  const JSON_URL = "https://d3a21s3joww9j4.cloudfront.net/viewer/images.json";
  const META_URL = "https://d3a21s3joww9j4.cloudfront.net/viewer/metadata.json";
  const API_BASE = "https://3p4utkstnb.execute-api.ap-northeast-1.amazonaws.com/prod";
  const EXCLUDE = ["viewer/", "viewer/index.html", "viewer/images.json"];
  const INITIAL_COUNT = 20;

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
        .filter(name => !EXCLUDE.includes(name))
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
  const displayedImages = filteredImages.slice(0, visibleCount);
  const hasMoreImages = displayedImages.length < filteredImages.length;

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

      {/* Contribution Calendar */}
      <ContributionCalendar images={images} />

      {/* U3a タグ絞り込み: 自動タグ(autoTags)のチップ。クリックでAND絞り込み。タグが無ければ非表示。 */}
      {chipTags.length > 0 && (
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
