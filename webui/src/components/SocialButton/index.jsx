import { useEffect } from 'react';
import { FaBook, FaCoffee, FaCrown, FaDiscord, FaLink } from 'react-icons/fa';

const ICONS_BY_ID = {
  discord: FaDiscord,
  kofi: FaCoffee,
  'ko-fi': FaCoffee,
  wiki: FaBook,
  throne: FaCrown,
};

const GRADIENT_STYLE_BY_ID = {
  discord: {
    backgroundImage:
      'linear-gradient(270deg,#5865F2,#404EED,#5865F2)',
    backgroundSize: '600% 600%',
    animation: 'socialGradient 180s ease infinite',
  },
  kofi: {
    backgroundImage: 'linear-gradient(270deg,#FF6433,#E04822,#FF6433)',
    backgroundSize: '600% 600%',
    animation: 'socialGradient 170s ease infinite',
  },
  'ko-fi': {
    backgroundImage: 'linear-gradient(270deg,#FF6433,#E04822,#FF6433)',
    backgroundSize: '600% 600%',
    animation: 'socialGradient 170s ease infinite',
  },
  wiki: {
    backgroundImage: 'linear-gradient(270deg,#EE8019,#C65C08,#EE8019)',
    backgroundSize: '600% 600%',
    animation: 'socialGradient 180s ease infinite',
  },
  throne: {
    backgroundImage: 'linear-gradient(270deg,#7C3AED,#5B21B6,#7C3AED)',
    backgroundSize: '600% 600%',
    animation: 'socialGradient 180s ease infinite',
  },
};

function useSocialButtonStyles() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const styleId = 'social-button-keyframes';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes socialGradient {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }
    `;
    document.head.appendChild(style);
  }, []);
}

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
  useSocialButtonStyles();
  const key = normalizeId(id, label);
  const Icon = ICONS_BY_ID[key] || FaLink;
  const gradientStyle = GRADIENT_STYLE_BY_ID[key] || null;
  const text = label || id || 'Link';

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={text}
      className={`inline-flex items-center w-full px-0.5 py-0.5 text-sm font-medium text-white transition justify-center gap-1 rounded-md ${
        gradientStyle ? '' : 'bg-slate-700 hover:bg-slate-600'
      } ${className}`}
      style={gradientStyle || undefined}
    >
      <Icon className="mr-0" />
      {text}
    </a>
  );
}
