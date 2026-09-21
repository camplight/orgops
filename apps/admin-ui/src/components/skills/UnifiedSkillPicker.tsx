import type { SkillInventoryItem, SkillRef } from "@orgops/schemas";

type UnifiedSkillPickerProps = {
  items: SkillInventoryItem[];
  selected: SkillRef | null;
  onChange: (ref: SkillRef) => void;
  disabled: boolean;
  selectedRefs?: readonly SkillRef[];
  onToggle?: (ref: SkillRef) => void;
  preloads?: Readonly<Record<string, boolean>>;
  mandatoryRefs?: readonly SkillRef[];
  onPreloadChange?: (ref: SkillRef, preload: boolean) => void;
};

function key(ref: SkillRef) {
  return ref.kind === "LOCAL"
    ? `LOCAL:${ref.localOrigin}:${ref.name}`
    : `CATALOG:${ref.packageReleaseId}`;
}
function label(item: SkillInventoryItem) {
  return item.ref.kind === "LOCAL"
    ? `${item.ref.name} · Local`
    : `${item.ref.name} · Catalog`;
}

export function UnifiedSkillPicker({ items, selected, onChange, disabled, selectedRefs, onToggle, preloads = {}, mandatoryRefs = [], onPreloadChange }: UnifiedSkillPickerProps) {
  if (selectedRefs && onToggle) {
    const selectedKeys = new Set(selectedRefs.map(key));
    const mandatoryKeys = new Set(mandatoryRefs.map(key));
    return (
      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="text-sm text-slate-300">Skills</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {items.map((item) => (
            <label key={key(item.ref)} className="flex min-w-0 items-start gap-2 rounded border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">
              <input type="checkbox" checked={selectedKeys.has(key(item.ref))} disabled={mandatoryKeys.has(key(item.ref))} onChange={() => onToggle(item.ref)} aria-label={`Select ${item.ref.name}`} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block truncate text-slate-200">{label(item)}{mandatoryKeys.has(key(item.ref)) ? " · Included by template" : ""}</span>
                <span className="block truncate text-xs text-slate-500">{item.description}</span>
                {item.readiness.state === "BLOCKED" ? <span className="block text-xs text-amber-300">{item.readiness.blockers.map((blocker) => blocker.code).join(", ")}</span> : null}
                {selectedKeys.has(key(item.ref)) && onPreloadChange ? <label className="mt-1 flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={preloads[key(item.ref)] === true || mandatoryKeys.has(key(item.ref))} disabled={mandatoryKeys.has(key(item.ref))} onChange={(event) => onPreloadChange(item.ref, event.target.checked)} />Preload{mandatoryKeys.has(key(item.ref)) ? " (required by template)" : ""}</label> : null}
              </span>
            </label>
          ))}
        </div>
        {items.length === 0 ? <p className="text-xs text-slate-500">No skills are available.</p> : null}
      </fieldset>
    );
  }

  const selectedKey = selected ? key(selected) : "";
  return (
    <label className="block min-w-0 text-sm text-slate-300" htmlFor="unified-skill-picker">
      <span className="sr-only">Skill</span>
      <select id="unified-skill-picker" aria-label="Skill" value={selectedKey} disabled={disabled} className="w-full min-w-0 rounded border border-slate-700 bg-slate-950 px-3 py-2" onChange={(event) => { const item = items.find((candidate) => key(candidate.ref) === event.target.value); if (item) onChange(item.ref); }}>
        <option value="">Select a skill</option>
        {items.map((item) => <option key={key(item.ref)} value={key(item.ref)}>{label(item)}</option>)}
      </select>
    </label>
  );
}
