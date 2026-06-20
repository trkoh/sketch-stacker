import { useState, useEffect } from 'react';
import ImageItem from './ImageItem';
import Modal from './Modal';
import ContributionCalendar from './ContributionCalendar';
import Masonry from 'react-masonry-css';

const ImageGallery = () => {
  const [images, setImages] = useState([]);
  const [displayedImages, setDisplayedImages] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalImageUrl, setModalImageUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // 管理モード: 認証情報はメモリ上のみ保持（localStorageには残さない＝再読込で消える）
  const [admin, setAdmin] = useState(null);
  const [adminForm, setAdminForm] = useState({ open: false, username: '', password: '' });
  // 管理UIはURLに ?admin が付いている時だけ表示（一般訪問者には一切出さない）。実際のガードはAPI側のBasic認証。
  const [adminUnlocked] = useState(() => new URLSearchParams(window.location.search).has('admin'));

  // 設定
  const BASE_URL = "https://d3a21s3joww9j4.cloudfront.net/";
  const JSON_URL = "https://d3a21s3joww9j4.cloudfront.net/viewer/images.json";
  const API_BASE = "https://3p4utkstnb.execute-api.ap-northeast-1.amazonaws.com/prod";
  const EXCLUDE = ["viewer/", "viewer/index.html", "viewer/images.json"];
  const INITIAL_COUNT = 20;

  useEffect(() => {
    fetchImages();
  }, []);

  const fetchImages = async () => {
    try {
      setLoading(true);
      const response = await fetch(JSON_URL, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        headers: {
          'Accept': 'application/json',
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const files = await response.json();

      // フィルタリングとソート
      const filteredFiles = files
        .filter(name => !EXCLUDE.includes(name))
        .sort((a, b) => b.localeCompare(a)); // 降順（新しい順）

      setImages(filteredFiles);
      setDisplayedImages(filteredFiles.slice(0, INITIAL_COUNT));
    } catch (err) {
      console.error("画像リスト取得失敗", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMore = () => {
    const currentCount = displayedImages.length;
    const nextBatch = images.slice(currentCount, currentCount + INITIAL_COUNT);
    setDisplayedImages([...displayedImages, ...nextBatch]);

    if (currentCount + INITIAL_COUNT >= images.length) {
      setShowAll(true);
    }
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
      setDisplayedImages(prev => prev.filter(n => n !== imageName));
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

  const hasMoreImages = !showAll && images.length > INITIAL_COUNT;

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
          Load More ({Math.min(INITIAL_COUNT, images.length - displayedImages.length)} more)
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
