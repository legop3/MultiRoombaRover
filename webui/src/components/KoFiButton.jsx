import { useSession } from "../context/SessionContext";
import { FaCoffee } from "react-icons/fa";

export default function KoFiButton({ text = "Support me on Ko-fi!", className = "" }) {
  const { session } = useSession();
  const kofiLink = session?.kofi?.link || null;

  if (!kofiLink) return null;

  return (
    <a
      href={kofiLink}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center w-full px-0.5 py-0.5 text-sm font-medium text-white kofi-animate-bg transition justify-center gap-1 ${className}`}
    >
      <FaCoffee className="mr-0" />
      {text}
    </a>
  );
}
