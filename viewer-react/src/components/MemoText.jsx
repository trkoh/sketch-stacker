import ReactMarkdown from 'react-markdown';

// メモ本文のMarkdownレンダリング(要件: メモ=自由記述Markdown / requirements.md)。
// react-markdown は生HTMLをレンダリングしない(エスケープする)のでXSS安全。
// リンクは新規タブで開き、タイルのクリック(拡大モーダル)に伝播させない。
const MemoText = ({ text }) => (
  <div className="memo-md">
    <ReactMarkdown
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </a>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  </div>
);

export default MemoText;
