import { FaBook, FaCoffee, FaCrown, FaDiscord, FaLink } from 'react-icons/fa';

const ICONS_BY_ID = {
  discord: FaDiscord,
  kofi: FaCoffee,
  'ko-fi': FaCoffee,
  wiki: FaBook,
  throne: FaCrown,
};

const VARIANT_BY_ID = {
  discord: 'rainbow-animate-bg',
  kofi: 'kofi-animate-bg',
  'ko-fi': 'kofi-animate-bg',
  wiki: 'wiki-animate-bg',
  throne: 'throne-animate-bg',
};

function normalizeId(id, label) {
  if (typeof id === 'string' && id.trim()) return id.trim().toLowerCase();
  if (typeof label === 'string' && label.trim()) {
    return label
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }
  return '';
}

export default function SocialButton({ id, label, url, className = '' }) {
  if (!url) return null;
  const key = normalizeId(id, label);
  const Icon = ICONS_BY_ID[key] || FaLink;
  const variantClass = VARIANT_BY_ID[key] || 'bg-slate-700 hover:bg-slate-600';
  const text = label || id || 'Link';

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={text}
      className={`inline-flex items-center w-full px-0.5 py-0.5 text-sm font-medium text-white transition justify-center gap-1 rounded-md ${variantClass} ${className}`}
    >
      <Icon className="mr-0" />
      {text}
    </a>
  );
}
