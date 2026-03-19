import { useState, useEffect, useRef } from "react";

/**
 * Returns a debounced copy of `value` that only updates after `delay` ms of
 * inactivity.  The first value is returned immediately (no initial delay).
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  const isFirst = useRef(true);

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      setDebounced(value);
      return;
    }
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}
