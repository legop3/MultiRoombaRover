// Compose one HA action from primitive controls. Required companion fields are
// sent together, while unrelated optional properties are never overwritten.
import { useState } from 'react';
import ToggleControl from './controls/ToggleControl';
import NumberControl from './controls/NumberControl';
import TextControl from './controls/TextControl';
import SelectControl from './controls/SelectControl';
import ButtonControl from './controls/ButtonControl';
import ColorControl from './controls/ColorControl';
import DateControl from './controls/DateControl';
import TimeControl from './controls/TimeControl';
import DateTimeControl from './controls/DateTimeControl';

const controls = { toggle: ToggleControl, number: NumberControl, text: TextControl, select: SelectControl,
  button: ButtonControl, color: ColorControl, date: DateControl, time: TimeControl, datetime: DateTimeControl };

export default function ActionControls({ action, entityName, disabled, onAction, hideButton = false }) {
  const [draft, setDraft] = useState({});
  const fields = action.fields.filter((field) => !field.hidden);
  const run = (field, value) => {
    if (disabled) return;
    const edits = field ? { ...draft, [field.key]: value } : { ...draft };
    const values = { ...edits };
    // Most commands are independent writes. A thermostat range or another
    // multi-input action also needs the remaining required values, using live
    // state/defaults unless the user has already supplied a local edit.
    for (const required of action.fields.filter((candidate) => candidate.required)) {
      if (values[required.key] === undefined) values[required.key] = required.state ?? required.default;
    }
    const missing = action.fields.some((candidate) => candidate.required
      && (values[candidate.key] === null || values[candidate.key] === undefined));
    if (missing) {
      // Retain only explicit edits. Remembering inferred companion values here
      // would overwrite newer HA state when the last required field is entered.
      setDraft(edits);
      return;
    }
    onAction(action.id, values);
    setDraft({});
  };
  const renderField = (field) => {
    const Control = controls[field.type];
    if (!Control) return null;
    const descriptor = { ...field, name: `${entityName}: ${field.name}`,
      state: Object.hasOwn(draft, field.key) ? draft[field.key] : field.state ?? field.default, available: true };
    return <div key={field.key} className="min-w-0 space-y-0.5">
      <span className="text-[0.68rem] text-slate-300" title={action.name}>{field.name}</span>
      <Control entity={descriptor} disabled={disabled} onChange={(value) => run(field, value)} />
    </div>;
  };
  const primary = fields.filter((field) => !field.advanced || field.required);
  const advanced = fields.filter((field) => field.advanced && !field.required);
  // HA sometimes marks setter inputs optional (for alternative payloads).
  // A parameterless Set/Select button would do nothing or fail, not represent
  // another useful control. Ordinary actions can still run with optional args.
  const setter = /^(set_|select_)|_set$/.test(action.service);
  const canRunWithoutFields = !action.fields.some((field) => field.required) && (!fields.length || !setter);
  if (!fields.length && hideButton) return null;
  return <div className={`min-w-0 space-y-0.5 ${fields.length ? 'w-full' : ''}`}>
    {/* Parameterless and optional-only actions remain usable as ordinary
        buttons; changing a field invokes that same named action directly. */}
    {!hideButton && canRunWithoutFields ? <ButtonControl entity={{ name: `${entityName}: ${action.name}`, label: action.name }} disabled={disabled} onChange={() => run()} /> : null}
    {primary.map(renderField)}
    {advanced.length ? <details className="text-[0.68rem] text-slate-400"><summary className="cursor-pointer">More {action.name.toLowerCase()} options</summary><div className="space-y-0.5">{advanced.map(renderField)}</div></details> : null}
    {Object.keys(draft).length ? <p className="text-[0.65rem] text-slate-400">Complete the required fields to apply.</p> : null}
  </div>;
}
