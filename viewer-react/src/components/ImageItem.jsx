const ImageItem = ({ imageName, baseUrl, onImageClick, adminMode, onDelete }) => {
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
    const imageUrl = getImageUrl();
    navigator.clipboard.writeText(imageUrl);
  };

  const handleOpenImage = (e) => {
    e.stopPropagation();
    const imageUrl = getImageUrl();
    window.open(imageUrl, "_blank");
  };

  const handleImageClick = () => {
    onImageClick(getImageUrl());
  };

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    onDelete(imageName);
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
        <button
          className="ctrl-btn delete-btn"
          onClick={handleDeleteClick}
          style={{ position: 'absolute', top: 4, left: 4, background: '#c0392b', color: '#fff', zIndex: 2, opacity: 1, visibility: 'visible' }}
        >
          削除
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

      {timestamp && (
        <span className="date-label">
          {unixToDateString(timestamp)}
        </span>
      )}
    </div>
  );
};

export default ImageItem;
