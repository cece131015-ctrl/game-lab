// Estado observable minimo entre el motor del juego y la interfaz React.
import { useRef, useSyncExternalStore } from 'react';

export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      let changed = false;
      for (const k in next) if (state[k] !== next[k]) { changed = true; break; }
      if (!changed) return;
      state = { ...state, ...next };
      for (const fn of subs) fn();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}

// Suscribe un componente a una parte del estado (solo se vuelve a pintar si esa parte cambia)
export function useStore(store, selector, eq = shallowEqual) {
  const cache = useRef({ has: false, value: undefined });
  const getSnapshot = () => {
    const v = selector(store.get());
    const c = cache.current;
    if (c.has && eq(c.value, v)) return c.value;
    c.has = true;
    c.value = v;
    return v;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
