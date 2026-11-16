import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export default function ThemedSelect({
  value,
  onChange,
  options = [],
  placeholder = 'Select…',
  className = '',
  buttonClassName = '',
  disabled = false,
  'aria-label': ariaLabel
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // Normalize options: can be array of strings or array of { value, label, dotColor, badge, icon }
  const normalizedOptions = options.map((opt) => {
    if (typeof opt === 'object' && opt !== null) {
      return {
        value: opt.value,
        label: opt.label || opt.value,
        dotColor: opt.dotColor,
        badge: opt.badge,
        icon: opt.icon
      };
    }
    return {
      value: opt,
      label: String(opt),
      dotColor: null,
      badge: null,
      icon: null
    };
  });

  const selectedOption = normalizedOptions.find((opt) => opt.value === value) || null;

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const handleEscape = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };

    if (open) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={`relative inline-block w-full ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        className={`w-full px-3 py-2 rounded-xl bg-bhodix-surface border border-bhodix-border text-bhodix-text text-xs flex items-center justify-between gap-2 hover:border-indigo-500/50 focus:outline-none focus:border-indigo-500 transition-colors select-none ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
        } ${buttonClassName}`}
      >
        <span className="flex items-center gap-2 truncate">
          {selectedOption?.dotColor && (
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: selectedOption.dotColor }}
            />
          )}
          {selectedOption?.icon && (
            <span className="shrink-0">{selectedOption.icon}</span>
          )}
          <span className="truncate">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-bhodix-textSubtle shrink-0 transition-transform duration-150 ${
            open ? 'rotate-180 text-indigo-400' : ''
          }`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 mt-1.5 z-[80] bg-bhodix-card border border-bhodix-border rounded-xl shadow-2xl p-1 max-h-60 overflow-y-auto space-y-0.5 animate-in fade-in-0 zoom-in-95 duration-100 backdrop-blur-md"
        >
          {normalizedOptions.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <div
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-indigo-600/15 text-indigo-500 font-medium'
                    : 'text-bhodix-text hover:bg-bhodix-hover hover:text-indigo-400'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  {opt.dotColor && (
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: opt.dotColor }}
                    />
                  )}
                  {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                  <span className="truncate capitalize">{opt.label}</span>
                </div>
                {isSelected && (
                  <Check className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                )}
              </div>
            );
          })}
          {normalizedOptions.length === 0 && (
            <div className="px-3 py-2 text-xs text-bhodix-textSubtle text-center">
              No options
            </div>
          )}
        </div>
      )}
    </div>
  );
}
