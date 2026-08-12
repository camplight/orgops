import { useMemo, useState } from "react";
import { Input } from "./Input";

export type SelectAutocompleteOption = {
  id: string;
  label: string;
  meta?: string;
};

type SelectAutocompleteProps = {
  value: string | null;
  options: SelectAutocompleteOption[];
  placeholder?: string;
  onChange: (id: string) => void;
};

export function SelectAutocomplete({
  value,
  options,
  placeholder = "Select...",
  onChange
}: SelectAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () => options.find((option) => option.id === value) ?? null,
    [options, value]
  );

  const normalizedQuery = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!normalizedQuery) return options.slice(0, 8);
    return options
      .filter((option) => {
        const searchable = `${option.label} ${option.meta ?? ""}`.toLowerCase();
        return searchable.includes(normalizedQuery);
      })
      .slice(0, 8);
  }, [normalizedQuery, options]);

  const inputValue = open ? query : selected?.label ?? query;

  return (
    <div className="relative">
      <Input
        value={inputValue}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onBlur={() => {
          // Let option clicks run before hiding the popover.
          setTimeout(() => setOpen(false), 100);
        }}
      />
      {open && (
        <div className="absolute z-10 mt-1 w-full max-h-64 overflow-auto rounded border border-slate-700 bg-slate-900 shadow-lg">
          {visible.map((option) => (
            <button
              key={option.id}
              type="button"
              className="w-full px-2 py-2 text-left hover:bg-slate-800"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(option.id);
                setQuery("");
                setOpen(false);
              }}
            >
              <div className="text-slate-200 text-sm">{option.label}</div>
              {option.meta && <div className="text-slate-500 text-xs">{option.meta}</div>}
            </button>
          ))}
          {visible.length === 0 && (
            <div className="px-2 py-2 text-slate-500 text-sm">No matches</div>
          )}
        </div>
      )}
    </div>
  );
}
