import { ChatIdentity, chatRowClass } from '../ChatMessageRow/index.jsx';

export default function ChatTypingRow({ message }) {
  return (
    <div className={`${chatRowClass(message)} italic opacity-80 border-slate-600/40 bg-slate-900/40`}>
      <ChatIdentity message={message} />
      <span className="text-slate-300">typing...</span>
    </div>
  );
}
