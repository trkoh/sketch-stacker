const Modal = ({ isOpen, imageUrl, memo, isPrivate, onClose }) => {
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
