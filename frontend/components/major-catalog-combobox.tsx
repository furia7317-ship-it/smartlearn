"use client";

import { useEffect, useId, useState } from "react";
import { Check, LoaderCircle, Search } from "lucide-react";

import {
  AuthRequestError,
  searchMajorCatalog,
  type MajorCatalogEntry,
  type MajorLevel,
} from "@/lib/auth";


interface MajorCatalogComboboxProps {
  level: MajorLevel;
  selected: MajorCatalogEntry | null;
  onSelect: (entry: MajorCatalogEntry | null) => void;
  onTouched?: () => void;
}

export function MajorCatalogCombobox({
  level,
  selected,
  onSelect,
  onTouched,
}: MajorCatalogComboboxProps) {
  const listId = useId();
  const [query, setQuery] = useState(selected?.name || "");
  const [results, setResults] = useState<MajorCatalogEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized || selected?.name === normalized) {
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      searchMajorCatalog(normalized, level)
        .then((items) => {
          if (!active) return;
          setResults(items);
          setOpen(true);
        })
        .catch((caught) => {
          if (!active) return;
          setResults([]);
          setError(caught instanceof AuthRequestError ? caught.message : "专业目录暂时无法检索");
          setOpen(true);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [level, query, selected?.name]);

  return (
    <div
      className="relative mt-2"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-[14px] z-10 size-4 text-[#8a7c67]" aria-hidden />
      <input
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          onSelect(null);
          onTouched?.();
          setOpen(Boolean(event.target.value.trim()));
        }}
        onFocus={() => setOpen(Boolean(query.trim()) && selected === null)}
        autoFocus
        placeholder={level === "undergraduate" ? "输入专业名称或代码检索" : "输入学科、专业学位名称或代码检索"}
        className="h-11 w-full rounded-md border border-[#d8cbb7] bg-white pl-10 pr-11 text-sm outline-none transition focus:border-[#8b5b18] focus:ring-2 focus:ring-[#8b5b18]/15"
      />
      {loading && <LoaderCircle className="absolute right-3 top-[14px] size-4 animate-spin text-[#8a7c67]" aria-hidden />}
      {selected && !loading && <Check className="absolute right-3 top-[14px] size-4 text-[#3d7a52]" aria-hidden />}

      {open && !selected && (
        <div
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-[#d8cbb7] bg-white p-1 shadow-[0_14px_35px_rgba(58,43,23,0.16)]"
        >
          {loading && results.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-[#756a59]">正在检索教育部专业目录</p>
          ) : error ? (
            <p role="alert" className="px-3 py-4 text-center text-xs text-[#983f3d]">{error}</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-[#756a59]">未找到教育部目录中的专业</p>
          ) : results.map((entry) => (
            <button
              key={`${entry.level}:${entry.code}`}
              type="button"
              role="option"
              aria-selected="false"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onSelect(entry);
                setQuery(entry.name);
                setResults([]);
                setOpen(false);
                setError("");
              }}
              className="flex w-full items-start gap-3 rounded px-3 py-2 text-left hover:bg-[#f3eadc] focus-visible:bg-[#f3eadc] focus-visible:outline-none"
            >
              <span className="min-w-0 flex-1">
                <strong className="block text-sm font-medium text-[#332512]">{entry.name}</strong>
                <span className="mt-0.5 block text-xs text-[#756a59]">{entry.domain} · {entry.category}</span>
              </span>
              <code className="shrink-0 pt-0.5 text-[11px] text-[#8a6331]">{entry.code}</code>
            </button>
          ))}
        </div>
      )}

      <div className="mt-1.5 flex min-h-5 items-center justify-between gap-3 text-xs">
        {selected ? (
          <span className="truncate text-[#3d6b4b]">已选择：{selected.name}（{selected.code}）</span>
        ) : (
          <span className="text-[#8a7c67]">输入关键词后，必须从检索结果中选择</span>
        )}
        <span className="shrink-0 text-[#8a7c67]">{level === "undergraduate" ? "本科目录 883 项" : "研究生目录 181 项"}</span>
      </div>
    </div>
  );
}
