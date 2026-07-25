import { captureEvent } from '../analytics.js';

const ImageItem = ({ imageName, baseUrl, onImageClick, adminMode, onDelete, onMemoEdit, memoInfo }) => {
  const extractTimestamp = (name) => {
    const m = name.match(/(\d{10,13})(?=\.[A-Za-z]+$)/);
    if (!m) return null;
    const num = Number(m[1]);
    return num > 1e12 ? Math.floor(num / 1000) : num; // 13桁→秒へ
  };

  const unixToDateString = (sec) => {
    const d = new Date(sec * 1000);
    return d.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }) + " " +
    d.toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  };

  const handleCopyUrl = (e) => {
    e.stopPropagation();
    // どの絵のURLがコピーされたかを計測(issue #59)
    captureEvent('image_copy', { imageId: imageName });
    const imageUrl = getImageUrl();
    navigator.clipboard.writeText(imageUrl);
  };

  const handleOpenImage = (e) => {
    e.stopPropagation();
    // どの絵がOpenされたかを計測(issue #59)
    captureEvent('image_open', { imageId: imageName });
    const imageUrl = getImageUrl();
    window.open(imageUrl, "_blank");
  };

  const handleImageClick = () => {
    onImageClick(getImageUrl(), imageName);
  };

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    onDelete(imageName);
  };

  const handleMemoClick = (e) => {
    e.stopPropagation();
    onMemoEdit(imageName);
  };

  const getImageUrl = () => {
    return baseUrl + imageName;  // 常にCloudFrontの実際の画像を使用
  };

  const timestamp = extractTimestamp(imageName);

  return (
    <div className="gallery-item">
      <img
        src={getImageUrl()}
        alt={imageName}
        loading="lazy"
        onClick={handleImageClick}
      />

      {adminMode && (
        <button className="ctrl-btn delete-btn" onClick={handleDeleteClick}>
          Delete
        </button>
      )}

      {adminMode && (
        <button className="ctrl-btn memo-btn" onClick={handleMemoClick}>
          Memo
        </button>
      )}

      <button
        className="ctrl-btn open-btn"
        onClick={handleOpenImage}
      >
        Open
      </button>

      <button
        className="ctrl-btn copy-btn"
        onClick={handleCopyUrl}
      >
        Copy
      </button>

      {/* メモの常時表示（全文）。非公開メモは管理モード時のみ渡ってくる */}
      {memoInfo && memoInfo.memo && (
        <div className="memo-preview" onClick={handleImageClick}>
          {memoInfo.visibility === 'private' && <span className="memo-lock" title="Private memo">Private</span>}
          {memoInfo.memo}
        </div>
      )}

      {timestamp && (
        <span className="date-label">
          {unixToDateString(timestamp)}
        </span>
      )}
    </div>
  );
};

export default ImageItem;
