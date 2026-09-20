import { useState } from 'react';
import { find } from 'linkifyjs';
import ReactPlayer from 'react-player';

function ChatEmbed({ url }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  // Only direct image paths are identifiable without fetching page metadata.
  const isImage = /\.(avif|gif|jpe?g|png|webp|svg)$/i.test(new URL(url).pathname);
  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block max-w-full">
        <img
          src={url}
          alt="Shared image"
          loading="lazy"
          className="max-h-60 max-w-full rounded-sm object-contain"
          onError={() => setFailed(true)}
        />
      </a>
    );
  }
  if (!ReactPlayer.canPlay(url)) return null;

  return (
    <div className="aspect-video w-full max-w-sm overflow-hidden rounded-sm">
      <ReactPlayer
        src={url}
        controls
        playing={false}
        width="100%"
        height="100%"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

export default function ChatEmbeds({ text }) {
  const urls = [...new Set(find(String(text || ''), 'url')
    .map((link) => link.href)
    .filter((url) => /^https?:\/\//i.test(url)))];

  return urls.map((url) => <ChatEmbed key={url} url={url} />);
}
