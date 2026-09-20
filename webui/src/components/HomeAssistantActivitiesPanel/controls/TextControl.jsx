import { useRef } from 'react';
import useDraftControl from '../useDraftControl';

export default function TextControl({ entity, disabled, onChange }) {
  const control = useDraftControl(onChange, disabled);
  const composing = useRef(false);
  // IME composition may pause mid-word, so it must finish before automatic
  // sending starts. Enter remains an immediate action for ordinary typing.
  return <>
    <input type={entity.password ? 'password' : 'text'} aria-label={entity.name}
      value={control.draft ?? (entity.available ? entity.state : '')} disabled={disabled}
      minLength={entity.min ?? undefined} maxLength={entity.max ?? 255}
      onChange={(event) => control.edit(event.target.value, !composing.current)}
      onCompositionStart={() => { composing.current = true; control.cancel(); }}
      onCompositionEnd={(event) => { composing.current = false; control.edit(event.currentTarget.value); }}
      onKeyDown={(event) => { if (event.key === 'Enter' && !composing.current) control.commit(event.currentTarget.value); }}
      className="w-full min-w-0 rounded-sm border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-xs text-slate-200 disabled:opacity-50" />
  </>;
}
