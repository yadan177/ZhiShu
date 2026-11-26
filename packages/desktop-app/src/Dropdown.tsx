import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";

type Option<Value extends string> = { value: Value; label: string; description?: string; disabled?: boolean };
type Props<Value extends string> = {
  label: string;
  value?: Value;
  options: Option<Value>[];
  onChange: (value: Value) => void;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
};

export function Dropdown<Value extends string>({ label, value, options, onChange, placeholder = "请选择", emptyLabel = "暂无选项", disabled, className = "" }: Props<Value>) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", time: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [placement, setPlacement] = useState({ above: false, maxHeight: 280 });
  const selected = options.find((option) => option.value === value);
  const enabled = options.flatMap((option, index) => option.disabled ? [] : [index]);

  function close(restoreFocus = false): void {
    setOpen(false);
    search.current = { text: "", time: 0 };
    if (restoreFocus) trigger.current?.focus();
  }
  function show(last = false): void {
    if (disabled) return;
    const current = options.findIndex((option) => option.value === value && !option.disabled);
    setActive(current >= 0 ? current : (last ? enabled.at(-1) : enabled[0]) ?? -1);
    setOpen(true);
  }
  function choose(index: number): void {
    const option = options[index];
    if (!option || option.disabled || disabled) return;
    close(true);
    onChange(option.value);
  }
  function handleKeys(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") { event.preventDefault(); close(true); }
    else if (event.key === "Tab") close(true);
    else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const position = enabled.indexOf(active);
      const next = event.key === "Home" ? enabled[0] : event.key === "End" ? enabled.at(-1)
        : event.key === "ArrowDown" ? enabled[Math.min(position + 1, enabled.length - 1)]
          : enabled[Math.max(position < 0 ? enabled.length - 1 : position - 1, 0)];
      setActive(next ?? -1);
    } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(active); }
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const character = event.key.toLocaleLowerCase();
      const previous = Date.now() - search.current.time < 700 ? search.current.text : "";
      const text = previous === character ? character : previous + character;
      search.current = { text, time: Date.now() };
      const ordered = text.length === 1 ? [...enabled.filter((index) => index > active), ...enabled.filter((index) => index <= active)] : enabled;
      const match = ordered.find((index) => options[index]?.label.toLocaleLowerCase().startsWith(text));
      if (match !== undefined) setActive(match);
    }
  }

  useLayoutEffect(() => {
    const button = trigger.current;
    if (!open || !button) return;
    const rect = button.getBoundingClientRect();
    const clipParent = button.closest<HTMLElement>(".workspace-scroll, .modal-body, .drawer-body");
    const clipRect = clipParent?.getBoundingClientRect();
    const bottomLimit = clipRect ? Math.min(window.innerHeight, clipRect.bottom) : window.innerHeight;
    const topLimit = clipRect ? Math.max(0, clipRect.top) : 0;
    const below = bottomLimit - rect.bottom - 12;
    const above = rect.top - topLimit - 12;
    const upwards = below < Math.min(240, above);
    setPlacement({ above: upwards, maxHeight: Math.max(72, Math.min(280, upwards ? above : below)) });
    list.current?.focus({ preventScroll: true });
  }, [open]);
  useLayoutEffect(() => {
    const menu = list.current;
    if (!open || !menu) return;
    const activeEl = menu.querySelector<HTMLElement>('[data-active="true"]');
    if (!activeEl) return;
    const itemTop = activeEl.offsetTop;
    const itemBottom = itemTop + activeEl.offsetHeight;
    if (itemTop < menu.scrollTop) {
      menu.scrollTop = itemTop;
    } else if (itemBottom > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = itemBottom - menu.clientHeight;
    }
  }, [open, active]);
  useEffect(() => {
    if (!open) return;
    if (active >= options.length || (active >= 0 && options[active]?.disabled)) {
      const current = options.findIndex((option) => option.value === value && !option.disabled);
      setActive(current >= 0 ? current : enabled[0] ?? -1);
    }
  }, [open, options, active, value]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    function outside(event: Event): void {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    }
    function resize(): void { close(true); }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    window.addEventListener("scroll", outside, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", resize);
    };
  }, [open]);

  return <div ref={root} className={`dropdown ${className}`}>
    <button ref={trigger} type="button" className={`dropdown-trigger${open ? " is-open" : ""}${selected ? "" : " is-placeholder"}`}
      role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
      disabled={disabled} title={selected?.description} onClick={() => open ? close() : show()}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(event.key === "ArrowUp"); }
      }}>
      <span className="dropdown-value"><span className="dropdown-option-label">{selected?.label ?? placeholder}</span>
        {selected?.description && <span className="dropdown-description">{selected.description}</span>}</span>
      <CaretDown size={20} className="dropdown-caret" aria-hidden="true" />
    </button>
    {open && <div ref={list} id={`${id}-list`} className={`dropdown-menu${placement.above ? " opens-up" : ""}`} role="listbox" aria-label={label}
      tabIndex={-1} aria-activedescendant={active >= 0 ? `${id}-option-${active}` : undefined} style={{ maxHeight: placement.maxHeight }} onKeyDown={handleKeys}>
      {options.length === 0 ? <div className="dropdown-empty">{emptyLabel}</div> : options.map((option, index) =>
        <div id={`${id}-option-${index}`} key={option.value} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined}
          className="dropdown-option" data-active={active === index} title={option.description}
          onPointerDown={(event) => event.preventDefault()} onPointerMove={() => { if (!option.disabled) setActive(index); }} onClick={() => choose(index)}>
          <span className="dropdown-value"><span className="dropdown-option-label">{option.label}</span>
            {option.description && <span className="dropdown-description">{option.description}</span>}</span>
          {option.value === value && <Check size={18} weight="bold" className="dropdown-check" aria-hidden="true" />}
        </div>)}
    </div>}
  </div>;
}
