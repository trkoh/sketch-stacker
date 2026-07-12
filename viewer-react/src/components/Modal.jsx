const Modal = ({ isOpen, imageUrl, memo, isPrivate, refPhotoUrls = [], onClose }) => {
  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className={`modal ${isOpen ? 'show' : ''}`} onClick={handleBackdropClick}>
      <div className="modal-body">
        <img src={imageUrl} alt="preview" />
        {/* U-P2: この絵に紐づくリファレンス写真（管理モード時のみ渡ってくる・非公開） */}
        {refPhotoUrls.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {refPhotoUrls.map((u, i) => (
              <img
                key={i}
                src={u}
                alt={`参照写真${i + 1}`}
                title="紐づけ済みのリファレンス写真（クリックで拡大）"
                onClick={(e) => { e.stopPropagation(); window.open(u, '_blank', 'noopener'); }}
                style={{ height: 72, borderRadius: 6, border: '2px solid rgba(255,255,255,0.8)', cursor: 'pointer' }}
              />
            ))}
          </div>
        )}
        {memo && (
          <div className="modal-memo">
            {isPrivate && <div className="modal-memo-private">🔒 非公開メモ（自分のみ）</div>}
            {memo}
          </div>
        )}
      </div>
    </div>
  );
};

export default Modal;
