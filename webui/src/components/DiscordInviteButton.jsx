import { useSession } from "../context/SessionContext";
import { FaDiscord } from "react-icons/fa";

export default function DiscordInviteButton({text = "Join our Discord!"}) {
  const { session } = useSession();
  const discordInvite = session?.discord?.invite || null;

  if (!discordInvite) return null;

  return (
    <a
      href={discordInvite}
      target="_blank"
      rel="noopener noreferrer"npm 
      className="inline-flex items-center w-full h-full text-white rainbow-animate-bg transition justify-center"
    // animated rainbow backgound
    // className="inline-flex items-center px-3 py-2 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white rounded hover:from-indigo-600 hover:via-purple-600 hover:to-pink-600 transition"
    >
      <FaDiscord className="mr-2" />
        {text}
    </a>
  );
}