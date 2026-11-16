import { useEffect, useRef } from 'react';

export default function useDialogFocus(open) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open || !ref.current) return undefined;
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    const focusable = () => [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
    requestAnimationFrame(() => (dialog.querySelector('[autofocus]') || focusable()[0])?.focus());
    const trapTab = (event) => {
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
    };
    dialog.addEventListener('keydown', trapTab);
    return () => {
      dialog.removeEventListener('keydown', trapTab);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [open]);

  return ref;
}
