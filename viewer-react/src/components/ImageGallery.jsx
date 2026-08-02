import { useState, useEffect, useRef } from 'react';
import ImageItem from './ImageItem';
import Modal from './Modal';
import ContributionCalendar from './ContributionCalendar';
import PhotoGallery from './PhotoGallery';
import Masonry from 'react-masonry-css';
import { captureEvent } from '../analytics.js';

const ImageGallery = () => {
  const [images, setImages] = useState([]);
  const [visibleCount, setVisibleCount] = useState(20);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalImageUrl, setModalImageUrl] = useState('');
  const [modalImageName, setModalImageName] = useState(''); // モーダルでメモを引くためのキー
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // U3a タグ絞り込み: metadata.json(U1射影) の autoTags を imageId->tags で保持。
  const [tagsById, setTagsById] = useState({});
  // メモ常時表示: 公開メモは metadata.json から（誰でも見える）。
  // 管理モード中は GET /memos（認証付き一括）で非公開含む全メモに置き換える。
  const [publicMemos, setPublicMemos] = useState({});   // imageId -> {memo, visibility:'public'}
  const [adminMemos, setAdminMemos] = useState(null);   // null=未取得（非管理時）
  // タグ絞り込み(AND)・期間絞り込み(年/月)。初期値はURLクエリ(?tags=,?y=,?m=)から復元=ブックマーク可能
  const [selectedTags, setSelectedTags] = useState(() => {
    const t = new URLSearchParams(window.location.search).get('tags');
    return t ? t.split(',').filter(Boolean) : [];
  });
  const [selectedYear, setSelectedYear] = useState(() => new URLSearchParams(window.location.search).get('y') || '');
  const [selectedMonth, setSelectedMonth] = useState(() => new URLSearchParams(window.location.search).get('m') || '');
  // カレンダーの日クリックで特定日(YYYY-MM-DD)に絞り込み。並び順は新しい順/古い順の切替
  const [selectedDate, setSelectedDate] = useState(() => new URLSearchParams(window.location.search).get('d') || '');
  const [sortOrder, setSortOrder] = useState(() => new URLSearchParams(window.location.search).get('sort') === 'old' ? 'old' : 'new');
  const [tagQuery, setTagQuery] = useState('');       // タグチップの絞り込み入力
  const [showAllTags, setShowAllTags] = useState(false); // 既定件数の制限を解除（全1136件を表示）
  // 管理モード: 認証情報はメモリ上のみ保持（localStorageには残さない＝再読込で消える）。
  // ブックマーク用に URL フラグメント #k=ユーザー名:パスワード での自動ログインに対応。
  // フラグメントはサーバへ送信されないため CDN/アクセスログに残らない（履歴・ブックマークには残る＝
  // 端末を触れる人は管理モードに入れる。それを許容するかはオーナーの運用判断）。
  const [admin, setAdmin] = useState(() => {
    const m = window.location.hash.match(/^#k=([^:]+):(.+)$/);
    if (!m) return null;
    try {
      return { username: decodeURIComponent(m[1]), password: decodeURIComponent(m[2]) };
    } catch {
      return { username: m[1], password: m[2] };
    }
  });
  const [adminForm, setAdminForm] = useState({ open: false, username: '', password: '' });
  // 管理UIはURLに ?admin か #k= が付いている時だけ表示（一般訪問者には一切出さない）。
  // 実際のガードはAPI側のBasic認証（URLの値が間違っていれば各APIが403を返すだけ）。
  const [adminUnlocked] = useState(() =>
    new URLSearchParams(window.location.search).has('admin') || window.location.hash.startsWith('#k=')
  );
  // U3b 意味検索（オーナー限定=ADR-005）: 検索語/結果/状態。結果は imageId のランキング配列（null=非検索）。
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  // 画像側ベクトル(embeddings.json)は重いので検索時に一度だけ遅延ロードしてメモリにキャッシュ。
  const [embeddingsCache, setEmbeddingsCache] = useState(null);
  // U4 メモ編集（オーナー限定）: 編集対象1枚のメモ本文と公開フラグを保持する小エディタの状態。
  const [memoEditor, setMemoEditor] = useState(null); // null=閉/{imageId,memo,visibility,loading,saving,error}
  // U-P1 リファレンス写真ビュー（管理モード限定）: 'images' | 'photos'
  const [viewMode, setViewMode] = useState('images');
  // U-P2: 写真一覧(presigned URL・embedding・linkedImages込み)。管理モード時に一括取得し、
  // 絵モーダルの参照写真表示と「絵→写真の手動紐づけピッカー」の両方で使う。
  const [photosList, setPhotosList] = useState(null);
  // 絵側からの手動紐づけピッカー: {imageId, sortedIds:配列|null(=新しい順のまま)}
  const [photoPicker, setPhotoPicker] = useState(null);
  // 参照写真のページ内拡大: {url, memo}。絵のモーダルの上に重ねて表示(Valueボタン付き)
  const [photoModal, setPhotoModal] = useState(null);
  // 無限スクロール: 末尾の番兵要素が見えたら自動で追加読み込みする IntersectionObserver
  const infiniteObserverRef = useRef(null);

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

  // 絞り込み条件が変わったら表示件数をリセット（先頭から見せ直す）
  useEffect(() => {
    setVisibleCount(INITIAL_COUNT);
  }, [selectedTags, selectedYear, selectedMonth, selectedDate, sortOrder]);

  // 絞り込み状態をURLクエリに反映(?y=&m=&tags=)。ブックマーク/共有で同じ絞り込みを再現できる。
  // 既存の ?admin と #k= はそのまま保持する。
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const setOrDel = (k, v) => { if (v) p.set(k, v); else p.delete(k); };
    setOrDel('y', selectedYear);
    setOrDel('m', selectedMonth);
    setOrDel('d', selectedDate);
    setOrDel('sort', sortOrder === 'old' ? 'old' : '');
    setOrDel('tags', selectedTags.join(','));
    const qs = p.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
  }, [selectedYear, selectedMonth, selectedDate, sortOrder, selectedTags]);

  // 管理モード有効化で全メモ（非公開含む）を一括取得しタイルに常時表示。解除で公開分のみに戻す。
  useEffect(() => {
    if (!admin) { setAdminMemos(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/memos`, {
          headers: { 'Authorization': 'Basic ' + btoa(`${admin.username}:${admin.password}`) },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const map = {};
        for (const m of (data && Array.isArray(data.memos)) ? data.memos : []) {
          if (m && m.imageId && (m.memo || (m.refPhotos && m.refPhotos.length))) {
            map[m.imageId] = { memo: m.memo || '', visibility: m.visibility || 'private', refPhotos: m.refPhotos || [] };
          }
        }
        if (!cancelled) setAdminMemos(map);
      } catch (e) {
        console.warn('メモ一覧の取得に失敗（公開メモのみ表示で継続）', e);
      }
    })();
    return () => { cancelled = true; };
  }, [admin]);

  // U-P2: 管理モード中、写真一覧を一度だけ取得(参照写真の表示＋手動紐づけピッカー用)。
  // （presigned URLは10分で失効するが、この用途では再ログイン/再読込で足りる）
  useEffect(() => {
    if (!admin) { setPhotosList(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/photos`, {
          headers: { 'Authorization': 'Basic ' + btoa(`${admin.username}:${admin.password}`) },
        });
        if (!res.ok) return; // 写真表示は補助機能。失敗しても絵のUIは成立させる
        const data = await res.json();
        if (!cancelled) setPhotosList((data && Array.isArray(data.photos)) ? data.photos : []);
      } catch (e) {
        console.warn('写真一覧の取得に失敗（参照写真表示・紐づけなしで継続）', e);
      }
    })();
    return () => { cancelled = true; };
  }, [admin]);

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
          const memoMap = {};
          for (const m of Array.isArray(meta) ? meta : []) {
            if (!m || !m.imageId) continue;
            if (Array.isArray(m.autoTags) && m.autoTags.length) {
              map[m.imageId] = m.autoTags;
            }
            // metadata.json の memo は公開分のみ射影されている（非公開は null）
            if (typeof m.memo === 'string' && m.memo) {
              memoMap[m.imageId] = { memo: m.memo, visibility: 'public' };
            }
          }
          setTagsById(map);
          setPublicMemos(memoMap);
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

  const handleImageClick = (imageUrl, imageName) => {
    // どの絵が拡大表示(タップ)されたかを計測(issue #59)
    captureEvent('image_tap', { imageId: imageName });
    setModalImageUrl(imageUrl);
    setModalImageName(imageName || '');
    setModalOpen(true);
  };

  const handleModalClose = () => {
    setModalOpen(false);
    setModalImageUrl('');
    setModalImageName('');
  };

  // 管理モードを有効化（認証情報をメモリに保持。ページを閉じれば消える）
  const enableAdmin = (e) => {
    e.preventDefault();
    if (!adminForm.username || !adminForm.password) return;
    setAdmin({ username: adminForm.username, password: adminForm.password });
    setAdminForm({ open: false, username: '', password: '' });
  };

  const disableAdmin = () => {
    setAdmin(null);
    setViewMode('images'); // 写真は管理モード限定なので解除時に絵へ戻す
  };

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

  // U4: メモ編集を開く。GET /memos/{key}（Basic認証）で現在のメモ＋公開フラグを読み込む。
  const openMemoEditor = async (imageName) => {
    if (!admin) return;
    setMemoEditor({ imageId: imageName, memo: '', visibility: 'private', loading: true, saving: false, error: null });
    try {
      const res = await fetch(`${API_BASE}/memos/${encodeURIComponent(imageName)}`, {
        headers: { 'Authorization': 'Basic ' + btoa(`${admin.username}:${admin.password}`) },
      });
      if (res.status === 401 || res.status === 403) {
        setMemoEditor(m => m && { ...m, loading: false, error: '認証に失敗しました。' });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMemoEditor(m => m && { ...m, memo: data.memo || '', visibility: data.visibility || 'private', loading: false });
    } catch (err) {
      console.error('メモ取得失敗', err);
      setMemoEditor(m => m && { ...m, loading: false, error: `読み込み失敗: ${err.message}` });
    }
  };

  // U4: メモ保存。PUT /memos/{key} で memo と visibility を更新。成功で閉じる。
  const saveMemo = async () => {
    if (!admin || !memoEditor) return;
    setMemoEditor(m => ({ ...m, saving: true, error: null }));
    try {
      const res = await fetch(`${API_BASE}/memos/${encodeURIComponent(memoEditor.imageId)}`, {
        method: 'PUT',
        headers: {
          'Authorization': 'Basic ' + btoa(`${admin.username}:${admin.password}`),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ memo: memoEditor.memo, visibility: memoEditor.visibility }),
      });
      if (res.status === 401 || res.status === 403) {
        setMemoEditor(m => m && { ...m, saving: false, error: '認証に失敗しました。' });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // タイル/モーダルの常時表示へ即反映（空メモは表示から外す）
      const savedId = memoEditor.imageId;
      const savedMemo = memoEditor.memo;
      const savedVis = memoEditor.visibility;
      setAdminMemos(prev => {
        const next = { ...(prev || {}) };
        if (savedMemo) next[savedId] = { memo: savedMemo, visibility: savedVis };
        else delete next[savedId];
        return next;
      });
      setMemoEditor(null); // 成功 → 閉じる
    } catch (err) {
      console.error('メモ保存失敗', err);
      setMemoEditor(m => m && { ...m, saving: false, error: `保存失敗: ${err.message}` });
    }
  };

  // 絵→写真の手動紐づけ: 絵側から写真ピッカーを開く。
  // 並びは「この絵との視覚類似度順」(絵か写真のembedding未生成なら新しい順のままフォールバック)。
  const openPhotoPicker = async (imageName) => {
    if (!admin) return;
    setPhotoPicker({ imageId: imageName, sortedIds: null });
    try {
      const embs = await loadEmbeddings();
      const mine = embs.find(e => e.imageId === imageName);
      if (mine && photosList) {
        const sortedIds = [...photosList]
          .map(p => ({ id: p.photoId, score: Array.isArray(p.embedding) ? cosine(mine.embedding, p.embedding) : -Infinity }))
          .sort((a, b) => b.score - a.score)
          .map(x => x.id);
        setPhotoPicker(prev => (prev && prev.imageId === imageName) ? { imageId: imageName, sortedIds } : prev);
      }
    } catch (e) {
      console.warn('類似ソート不可(新しい順で表示)', e);
    }
  };

  // 紐づけ⇄解除。既存の写真側API PUT /photos/{photoId} をそのまま利用
  // (linkImageAdd/Remove。両テーブルへの相互保存はサーバ側が行う)。成功したらローカル状態へ即反映。
  const togglePhotoLink = async (imageId, photoId, linked) => {
    if (!admin) return;
    try {
      const res = await fetch(`${API_BASE}/photos/${encodeURIComponent(photoId)}`, {
        method: 'PUT',
        headers: {
          'Authorization': 'Basic ' + btoa(`${admin.username}:${admin.password}`),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(linked ? { linkImageRemove: imageId } : { linkImageAdd: imageId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAdminMemos(prev => {
        const next = { ...(prev || {}) };
        const cur = next[imageId] || { memo: '', visibility: 'private', refPhotos: [] };
        const set = new Set(cur.refPhotos || []);
        if (linked) set.delete(photoId); else set.add(photoId);
        next[imageId] = { ...cur, refPhotos: [...set] };
        return next;
      });
      setPhotosList(prev => prev ? prev.map(p => p.photoId === photoId
        ? { ...p, linkedImages: linked ? (p.linkedImages || []).filter(i => i !== imageId) : [...(p.linkedImages || []), imageId] }
        : p) : prev);
    } catch (err) {
      alert(`Failed to update link: ${err.message}`);
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>Error: {error}</div>;
  }

  // メモ常時表示: 管理モード中は全メモ（一括取得済・非公開含む）、それ以外は公開メモのみ。
  const memosById = adminMemos || publicMemos;
  // 参照写真のページ内拡大用: photoId -> {url, memo} (撮影メモも拡大表示に出す)
  const photoById = photosList ? Object.fromEntries(photosList.map(p => [p.photoId, p])) : null;
  // 指定した絵の紐づけ写真を {url, memo} 配列で返す(タイル・モーダル共通)
  const refPhotosOf = (imageName) =>
    admin && photoById && memosById[imageName]
      ? (memosById[imageName].refPhotos || [])
          .map(id => photoById[id])
          .filter(Boolean)
          .map(p => ({ url: p.url, memo: p.memo || '' }))
      : [];

  // ファイル名先頭のタイムスタンプ(ms/秒)から年月を得る（ImageItemの日付表示と同じ規約）
  const dateOfImage = (name) => {
    const m = name.match(/(\d{10,13})(?=\.[A-Za-z]+$)/);
    if (!m) return null;
    const num = Number(m[1]);
    const d = new Date(num > 1e12 ? num : num * 1000);
    return { y: d.getFullYear(), mo: d.getMonth() + 1 };
  };

  // カレンダーと同じ規約(UTCのYYYY-MM-DD)で日付キーを得る。日クリック絞り込みの照合に使う
  const dateKeyOfImage = (name) => {
    const m = name.match(/(\d{10,13})(?=\.[A-Za-z]+$)/);
    if (!m) return null;
    const num = Number(m[1]);
    return new Date(num > 1e12 ? num : num * 1000).toISOString().split('T')[0];
  };

  // タグ(AND)＋期間(年/月)＋特定日で絞り込み。
  const filteredImages = images.filter(name => {
    if (selectedTags.length > 0) {
      const tags = tagsById[name];
      if (!tags || !selectedTags.every(t => tags.includes(t))) return false;
    }
    if (selectedYear || selectedMonth) {
      const d = dateOfImage(name);
      if (!d) return false;
      if (selectedYear && String(d.y) !== selectedYear) return false;
      if (selectedMonth && String(d.mo) !== selectedMonth) return false;
    }
    if (selectedDate && dateKeyOfImage(name) !== selectedDate) return false;
    return true;
  });
  // 並び順: images はファイル名降順(新しい順)なので、古い順は反転するだけ
  const orderedImages = sortOrder === 'old' ? [...filteredImages].reverse() : filteredImages;
  // 意味検索が有効なら、その類似度ランキング（既にソート済み・上位N件）を優先表示。
  const searchActive = searchResults !== null;
  const displayedImages = searchActive ? searchResults : orderedImages.slice(0, visibleCount);
  const hasMoreImages = !searchActive && displayedImages.length < orderedImages.length;

  // モーダルの前後ナビ: いま表示中の並び(検索中はランキング)の中を移動する
  const navList = searchActive ? searchResults : orderedImages;
  const navIndex = modalImageName ? navList.indexOf(modalImageName) : -1;
  const navModal = (delta) => {
    const next = navIndex + delta;
    if (navIndex < 0 || next < 0 || next >= navList.length) return;
    const name = navList[next];
    captureEvent('image_tap', { imageId: name, source: 'modal_nav' });
    setModalImageUrl(BASE_URL + name);
    setModalImageName(name);
    // ナビで表示範囲の先まで進んだら、閉じた後のグリッドにも追いつかせる
    if (!searchActive && next + 1 > visibleCount) setVisibleCount(next + 1);
  };

  // 期間ドロップダウン用の件数集計（月の件数は選択中の年の中で数える）
  const yearCounts = {};
  const monthCounts = {};
  for (const name of images) {
    const d = dateOfImage(name);
    if (!d) continue;
    yearCounts[d.y] = (yearCounts[d.y] || 0) + 1;
    if (!selectedYear || String(d.y) === selectedYear) monthCounts[d.mo] = (monthCounts[d.mo] || 0) + 1;
  }
  const years = Object.keys(yearCounts).sort((a, b) => b - a);

  // タグチップ用: 出現頻度の高い順。
  // 経緯: 当初は上位N件で切り捨てていて「全タグ」ボタンが見落とされ選べない、と指摘 → 切り捨てを
  // 撤廃して全件スクロールにしたが、タグは1136個あり、狭い枠に全部詰め込むとスクロールバーの
  // つまみが比率的にほぼ0pxになり「浮いた点」にしか見えず実用上も操作不能だった。
  // → 既定は上位60件（枠に収まりスクロール自体ほぼ不要）+ 検索欄 + 目立つ「全タグ表示」ボタン。
  const TAG_DEFAULT_LIMIT = 60;
  const tagCounts = {};
  for (const name of images) {
    for (const t of tagsById[name] || []) tagCounts[t] = (tagCounts[t] || 0) + 1;
  }
  const allTags = Object.keys(tagCounts)
    .sort((a, b) => tagCounts[b] - tagCounts[a] || a.localeCompare(b));
  const tagQ = tagQuery.trim();
  const visibleTags = tagQ
    ? allTags.filter(t => t.includes(tagQ))
    : (showAllTags ? allTags : allTags.slice(0, TAG_DEFAULT_LIMIT));
  const chipTags = Array.from(new Set([...selectedTags, ...visibleTags]));

  // 無限スクロールの番兵(コールバックref)。要素が画面下600pxに近づいたら40件追加。
  // 番兵は hasMoreImages のときだけ描画されるので、全件表示済みなら発火しない。
  const loadMoreSentinel = (node) => {
    if (infiniteObserverRef.current) {
      infiniteObserverRef.current.disconnect();
      infiniteObserverRef.current = null;
    }
    if (node) {
      infiniteObserverRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) setVisibleCount(c => c + 40);
      }, { rootMargin: '600px' });
      infiniteObserverRef.current.observe(node);
    }
  };

  const breakpointColumns = {
    default: 6,
    1200: 5,
    900: 4,
    700: 3,
    500: 2,
    350: 1
  };

  return (
    <>
      {/* 最小ヘッダ: 総数だけ。ワードマークは意図的に出さない（オーナー指定） */}
      {images.length > 0 && (
        <div className="site-header">
          <span className="site-count">{images.length}</span>
        </div>
      )}

      {/* 管理UI: URLに ?admin が付いている時だけ表示。一般訪問者には何も出さない */}
      {adminUnlocked && (
      <div className="admin-bar">
        {!admin && !adminForm.open && (
          <button className="btn btn-dark" onClick={() => setAdminForm({ ...adminForm, open: true })}>
            Admin
          </button>
        )}
        {!admin && adminForm.open && (
          <form onSubmit={enableAdmin}>
            <input
              placeholder="Username"
              autoComplete="username"
              value={adminForm.username}
              onChange={e => setAdminForm({ ...adminForm, username: e.target.value })}
            />
            <input
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              value={adminForm.password}
              onChange={e => setAdminForm({ ...adminForm, password: e.target.value })}
            />
            <button className="btn btn-dark" type="submit">Sign in</button>
            <button className="btn" type="button" onClick={() => setAdminForm({ open: false, username: '', password: '' })}>
              Cancel
            </button>
          </form>
        )}
        {admin && (
          <>
            <span className="admin-live">Admin mode</span>
            <button className="btn" onClick={disableAdmin}>Sign out</button>
            {/* U-P1: 絵/リファレンス写真の切替（写真は非公開・管理モード限定） */}
            <button
              className={`btn btn-dark ${viewMode === 'photos' ? 'is-active' : ''}`}
              onClick={() => setViewMode(m => m === 'photos' ? 'images' : 'photos')}
            >
              {viewMode === 'photos' ? 'Drawings' : 'Reference photos'}
            </button>
          </>
        )}
      </div>
      )}

      {/* U-P1 リファレンス写真ビュー（管理モード限定）。絵のUIとは排他表示 */}
      {admin && viewMode === 'photos' ? (
        <PhotoGallery admin={admin} apiBase={API_BASE} baseUrl={BASE_URL} embedUrl={EMBED_URL} />
      ) : (
      <>


      {/* フィルタ枠: カレンダー・期間・タグ・(管理時)意味検索を1つの視覚的な枠にまとめる。
          以前はそれぞれ独立したブロックで、「ここを操作すると絞り込める」ことが伝わらなかった
          （オーナーフィードバック）。枠+見出し「Filter」で1つの操作対象であることを明示する。 */}
      {images.length > 0 && (
        <section className="filters-panel">
          <div className="filters-label">Filter</div>

          {/* U3b 意味検索: オーナー限定（クエリ埋め込みAPIがBasic認証必須=ADR-005）。管理モード時のみ表示。 */}
          {admin && (
            <form onSubmit={handleSearch} className="semantic-search">
              <input
                className="input"
                placeholder="Search by meaning (e.g. mountain ridge, girl in uniform)"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
              />
              <button type="submit" className="btn btn-dark" disabled={searching || !searchInput.trim()}>
                {searching ? 'Searching…' : 'Search'}
              </button>
              {searchActive && (
                <button type="button" className="btn" onClick={clearSearch}>
                  Clear ({searchResults.length})
                </button>
              )}
              {searchError && <span className="search-error">{searchError}</span>}
            </form>
          )}

          {/* Contribution Calendar（日セルのクリックでその日の絵に絞り込み） */}
          <ContributionCalendar
            images={images}
            selectedDate={selectedDate}
            onDayClick={(dateKey) => setSelectedDate(prev => prev === dateKey ? '' : dateKey)}
          />

          {/* 期間(年/月)絞り込み。ファイル名タイムスタンプ由来なので追加データ不要。
              意味検索が有効な間は二重フィルタの混乱を避けるため非表示。 */}
          {!searchActive && (
            <div className="toolbar">
              <select
                className="select"
                value={selectedYear}
                onChange={e => { setSelectedYear(e.target.value); setSelectedMonth(''); }}
              >
                <option value="">All years</option>
                {years.map(y => <option key={y} value={y}>{y} ({yearCounts[y]})</option>)}
              </select>
              <select
                className="select"
                value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)}
              >
                <option value="">All months</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).filter(mo => monthCounts[mo]).map(mo => (
                  <option key={mo} value={String(mo)}>{mo} ({monthCounts[mo]})</option>
                ))}
              </select>
              {(selectedYear || selectedMonth) && (
                <button className="chip" onClick={() => { setSelectedYear(''); setSelectedMonth(''); }}>
                  Clear period
                </button>
              )}
              {/* カレンダー日クリックの絞り込み表示(クリックで解除) */}
              {selectedDate && (
                <button className="chip chip-on" onClick={() => setSelectedDate('')} title="Click to clear">
                  {selectedDate} ×
                </button>
              )}
              <button className="chip" onClick={() => setSortOrder(o => o === 'old' ? 'new' : 'old')} title="Toggle sort order">
                {sortOrder === 'old' ? 'Oldest first' : 'Newest first'}
              </button>
              <span className="result-count">
                {filteredImages.length} / {images.length}
              </span>
            </div>
          )}

          {/* U3a タグ絞り込み: 自動タグ(autoTags)のチップ。クリックでAND絞り込み。タグが無ければ非表示。
              経緯: 全1136件を短い枠に詰め込むとスクロールバーのつまみが比率的に消えて操作不能
              だったため、既定は上位60件（枠内に収まる）+ 検索 + 明確な「Show all」ボタンに変更。
              意味検索が有効な間は二重フィルタの混乱を避けるため非表示。 */}
          {!searchActive && allTags.length > 0 && (
            <div className="tag-filter">
              <div className="tag-filter-head">
                {/* AI生成である明示(#56)は常時表示を維持する。#65のリデザインでツールチップのみに
                    格下げされたが、ホバーできないスマホでは伝わらないため文言をラベルに戻した */}
                <span
                  className="tag-filter-hint"
                  title="タグは画像からAI（Amazon Bedrock）が自動生成したものです。手動では付けていません。クリックで絞り込み（複数選択=AND）。"
                >
                  🤖 AI自動タグ
                </span>
                <input
                  className="input"
                  placeholder={`Search ${allTags.length} tags`}
                  value={tagQuery}
                  onChange={e => setTagQuery(e.target.value)}
                />
                {selectedTags.length > 0 && (
                  <button className="chip" onClick={() => setSelectedTags([])}>
                    Clear ({filteredImages.length})
                  </button>
                )}
              </div>
              <div className="tag-chip-scroll">
                {chipTags.map(tag => {
                  const on = selectedTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      className={`chip ${on ? 'chip-on' : ''}`}
                      onClick={() => toggleTag(tag)}
                    >
                      {tag}{tagCounts[tag] ? ` (${tagCounts[tag]})` : ''}
                    </button>
                  );
                })}
                {chipTags.length === 0 && (
                  <span className="result-count">No tags match "{tagQ}"</span>
                )}
              </div>
              {!tagQ && allTags.length > TAG_DEFAULT_LIMIT && (
                <button className="show-all-tags" onClick={() => setShowAllTags(s => !s)}>
                  {showAllTags ? 'Show fewer tags' : `Show all ${allTags.length} tags`}
                </button>
              )}
            </div>
          )}
        </section>
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
            onMemoEdit={openMemoEditor}
            onLinkPhotos={openPhotoPicker}
            memoInfo={memosById[imageName]}
            refPhotos={
              // 管理モード時: 紐づけ済み参照写真をタイルに常時表示(モーダルを開かなくても見える)
              refPhotosOf(imageName)
            }
            onRefPhotoClick={(p) => setPhotoModal(p)}
          />
        ))}
      </Masonry>

      {/* 無限スクロール: この番兵が画面に近づくと自動で追加読み込み。ボタンは「一気に全部」用 */}
      {hasMoreImages && (
        <div ref={loadMoreSentinel} style={{ textAlign: 'center' }}>
          <button
            className="load-more"
            onClick={() => setVisibleCount(filteredImages.length)}
          >
            Show all ({filteredImages.length - displayedImages.length} more)
          </button>
        </div>
      )}

      <Modal
        isOpen={modalOpen}
        imageUrl={modalImageUrl}
        memo={modalImageName && memosById[modalImageName] ? memosById[modalImageName].memo : ''}
        isPrivate={!!(modalImageName && memosById[modalImageName] && memosById[modalImageName].visibility === 'private')}
        refPhotoUrls={
          // U-P2: この絵に紐づく参照写真（管理モード時のみ）
          modalImageName ? refPhotosOf(modalImageName) : []
        }
        onRefPhotoClick={(p) => setPhotoModal(p)}
        onPrev={() => { if (!photoModal) navModal(-1); }}
        onNext={() => { if (!photoModal) navModal(1); }}
        hasPrev={navIndex > 0}
        hasNext={navIndex >= 0 && navIndex < navList.length - 1}
        onClose={() => { if (!photoModal) handleModalClose(); }}
      />

      {/* 参照写真のページ内拡大(絵のモーダルの上に重なる)。撮影メモ表示＋Valueボタン付き */}
      <Modal
        isOpen={!!photoModal}
        imageUrl={photoModal ? photoModal.url : ''}
        memo={photoModal ? photoModal.memo : ''}
        isPrivate={true}
        valueUrl={photoModal ? photoModal.url : ''}
        onClose={() => setPhotoModal(null)}
      />

      {/* 絵→写真の手動紐づけピッカー（オーナー限定）: 使ったリファレンス写真をタップで紐づけ⇄解除 */}
      {photoPicker && (
        <div className="editor-overlay" onClick={() => setPhotoPicker(null)}>
          <div
            className="editor-card"
            style={{ width: 'min(760px, 94vw)', maxHeight: '86vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="editor-head">
              <strong>Link reference photos</strong>
              <span className="editor-key">{photoPicker.imageId}</span>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
              <img className="editor-thumb" src={BASE_URL + photoPicker.imageId} alt="" />
              <div style={{ fontSize: '0.8rem', color: 'var(--ink-2)' }}>
                {photoPicker.sortedIds
                  ? 'この絵と似ている順に並んでいます。使った写真をタップで紐づけ⇄解除。'
                  : '新しい順に並んでいます。使った写真をタップで紐づけ⇄解除。'}
              </div>
            </div>
            {!photosList && (
              <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>
                写真一覧を取得できていません。管理モードに入り直してください。
              </div>
            )}
            {photosList && photosList.length === 0 && (
              <div style={{ color: 'var(--ink-2)', fontSize: '0.85rem' }}>リファレンス写真がまだありません。</div>
            )}
            {photosList && photosList.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                {(photoPicker.sortedIds
                  ? photoPicker.sortedIds.map(id => photosList.find(p => p.photoId === id)).filter(Boolean)
                  : photosList
                ).map(p => {
                  const linked = !!(memosById[photoPicker.imageId] && (memosById[photoPicker.imageId].refPhotos || []).includes(p.photoId));
                  return (
                    <div
                      key={p.photoId}
                      onClick={() => togglePhotoLink(photoPicker.imageId, p.photoId, linked)}
                      title={linked ? 'タップで紐づけ解除' : 'タップで紐づけ'}
                      style={{ cursor: 'pointer', border: linked ? '3px solid var(--accent)' : '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}
                    >
                      <img src={p.url} alt={p.photoId} loading="lazy" crossOrigin="anonymous" style={{ width: '100%', display: 'block' }} />
                      <div style={{ fontSize: '0.7rem', padding: '2px 6px', background: linked ? 'var(--accent-soft)' : 'var(--surface)', minHeight: 18 }}>
                        {linked ? '✓ Linked' : (p.memo ? p.memo.slice(0, 24) : '')}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="editor-actions" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => setPhotoPicker(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* U4 メモ編集（オーナー限定）: 中央のモーダルでメモ本文＋公開/非公開トグルを編集 */}
      {memoEditor && (
        <div className="editor-overlay" onClick={() => !memoEditor.saving && setMemoEditor(null)}>
          <div className="editor-card" onClick={e => e.stopPropagation()}>
            <div className="editor-head">
              <strong>Edit memo</strong>
              <span className="editor-key">{memoEditor.imageId}</span>
            </div>
            <div className="editor-row">
              <img className="editor-thumb" src={BASE_URL + memoEditor.imageId} alt="" />
              <textarea
                className="editor-textarea"
                placeholder={memoEditor.loading ? 'Loading…' : 'Reflection memo (free text)'}
                value={memoEditor.memo}
                disabled={memoEditor.loading || memoEditor.saving}
                onChange={e => setMemoEditor(m => ({ ...m, memo: e.target.value }))}
              />
            </div>
            <label className="editor-visibility">
              <input
                type="checkbox"
                checked={memoEditor.visibility === 'public'}
                disabled={memoEditor.loading || memoEditor.saving}
                onChange={e => setMemoEditor(m => ({ ...m, visibility: e.target.checked ? 'public' : 'private' }))}
              />
              Make this memo public (off = private, default)
            </label>
            {memoEditor.error && <div className="editor-error">{memoEditor.error}</div>}
            <div className="editor-actions">
              <button className="btn" onClick={() => setMemoEditor(null)} disabled={memoEditor.saving}>Cancel</button>
              <button className="btn btn-dark" onClick={saveMemo} disabled={memoEditor.loading || memoEditor.saving}>
                {memoEditor.saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </>
  );
};

export default ImageGallery;
