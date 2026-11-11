import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { User } from '../types';
import { initials } from '../util';

export function Popover({ anchor, onClose, children, width, align = 'left' }: { anchor: HTMLElement; onClose: () => void; children: ReactNode; width?: number; align?: 'left' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current!;
    const a = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = align === 'right' ? a.right - w : a.left;
    let top = a.bottom + 4;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (left < 8) left = 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - h - 4);
    setPos((p) => (p && p.top === top && p.left === left ? p : { top, left }));
  });

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const t = setTimeout(() => document.addEventListener('mousedown', down), 0);
    document.addEventListener('keydown', key);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="popover" style={{ width, top: pos?.top ?? -9999, left: pos?.left ?? -9999 }} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>,
    document.body,
  );
}

/** Botón que abre un popover anclado a sí mismo. */
export function PopButton({
  label,
  className = 'btn',
  title,
  width,
  align,
  children,
}: {
  label: ReactNode;
  className?: string;
  title?: string;
  width?: number;
  align?: 'left' | 'right';
  children: (close: () => void) => ReactNode;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button className={className + (anchor ? ' active' : '')} title={title} onClick={(e) => { e.stopPropagation(); setAnchor(anchor ? null : e.currentTarget); }}>
        {label}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={width} align={align}>
          {children(() => setAnchor(null))}
        </Popover>
      )}
    </>
  );
}

export function Avatar({ user, size = 26 }: { user?: User | null; size?: number }) {
  return (
    <span className="avatar" title={user?.name || 'Sin asignar'} style={{ width: size, height: size, fontSize: size * 0.4, background: user?.color || '#c4c4c4' }}>
      {user ? initials(user.name) : '?'}
    </span>
  );
}

/** Texto editable en línea: clic para editar, Enter/blur para guardar. */
export function Editable({ value, onSave, className = '', placeholder, multiline }: { value: string; onSave: (v: string) => void; className?: string; placeholder?: string; multiline?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!editing)
    return (
      <span className={'editable ' + className + (value ? '' : ' placeholder')} onClick={(e) => { e.stopPropagation(); setDraft(value); setEditing(true); }}>
        {value || placeholder || ''}
      </span>
    );
  const commit = () => {
    setEditing(false);
    if (draft.trim() !== value) onSave(draft.trim());
  };
  const props = {
    autoFocus: true,
    className: 'editable-input ' + className,
    value: draft,
    placeholder,
    onChange: (e: any) => setDraft(e.target.value),
    onBlur: commit,
    onClick: (e: any) => e.stopPropagation(),
    onKeyDown: (e: any) => {
      if (e.key === 'Enter' && !(multiline && e.shiftKey)) commit();
      if (e.key === 'Escape') setEditing(false);
    },
  };
  return multiline ? <textarea rows={2} {...props} /> : <input {...props} />;
}
