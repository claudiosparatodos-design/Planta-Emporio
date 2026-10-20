import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from './api.js';
import { useToast } from '../components/overlay.jsx';

export function useAuth() {
  return useQuery({ queryKey: ['auth'], queryFn: () => api.get('/auth/status'), staleTime: 60_000 });
}

export function useMe() {
  const { data } = useAuth();
  return data?.user || null;
}

export function useCan(permission) {
  const me = useMe();
  return Boolean(me?.permissions?.includes(permission));
}

export function useWorkspace() {
  const { data } = useAuth();
  return data?.workspace || { name: 'Planta-Emporio', currency: 'MXN' };
}

export function useMembers() {
  return useQuery({ queryKey: ['members'], queryFn: () => api.get('/members'), staleTime: 60_000 });
}

/** Mapa id → integrante (incluye desactivados para mostrar historiales). */
export function useMemberMap() {
  const { data } = useMembers();
  return useMemo(() => new Map((data || []).map((m) => [m.id, m])), [data]);
}

export function useActiveMembers() {
  const { data } = useMembers();
  return useMemo(() => (data || []).filter((m) => m.status === 'active'), [data]);
}

export function useTags() {
  return useQuery({ queryKey: ['tags'], queryFn: () => api.get('/tags'), staleTime: 60_000 });
}

export function useProjects(params = {}) {
  return useQuery({ queryKey: ['projects', 'list', params], queryFn: () => api.get(`/projects${qs(params)}`) });
}

export function useFinanceMeta(enabled = true) {
  return useQuery({ queryKey: ['finance', 'meta'], queryFn: () => api.get('/finance/meta'), enabled, staleTime: 30_000 });
}

/**
 * Mutación con aviso automático de error y refresco de consultas.
 * invalidate: lista de claves (primer elemento) a refrescar tras el éxito.
 */
export function useAction(fn, { invalidate = [], success, onSuccess, onError } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data, vars) => {
      if (invalidate.length) qc.invalidateQueries({ predicate: (q) => invalidate.includes(q.queryKey[0]) });
      if (success) toast.success(typeof success === 'function' ? success(data, vars) : success);
      onSuccess?.(data, vars);
    },
    onError: (err, vars) => {
      if (onError) onError(err, vars);
      else toast.error(err);
    },
  });
}

export function useDebounced(value, delay = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const fn = () => setMatches(m.matches);
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, [query]);
  return matches;
}

export const useIsMobile = () => useMediaQuery('(max-width: 820px)');

/** Preferencia personal guardada en el servidor (prefs del usuario). */
export function usePref(key, fallback) {
  const me = useMe();
  const qc = useQueryClient();
  const value = me?.prefs?.[key] ?? fallback;
  const timer = useRef(null);
  const set = useCallback(
    (next) => {
      qc.setQueryData(['auth'], (old) => (old?.user ? { ...old, user: { ...old.user, prefs: { ...old.user.prefs, [key]: next } } } : old));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        api.patch('/members/me', { prefs: { [key]: next } }).catch(() => {});
      }, 400);
    },
    [key, qc],
  );
  return [value, set];
}

/** Preferencia local del navegador (solo comodidades: pestaña elegida, panel colapsado…). */
export function useLocal(key, fallback) {
  const [v, setV] = useState(() => {
    try {
      const raw = localStorage.getItem(`pe:${key}`);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  });
  const set = useCallback(
    (next) => {
      setV(next);
      try {
        localStorage.setItem(`pe:${key}`, JSON.stringify(next));
      } catch {
        /* sin almacenamiento */
      }
    },
    [key],
  );
  return [v, set];
}

export function useFavorites() {
  return useQuery({ queryKey: ['favorites'], queryFn: () => api.get('/favorites'), staleTime: 30_000 });
}

export function useIsFavorite(type, id) {
  const { data } = useFavorites();
  return Boolean(data?.some((f) => f.type === type && f.id === Number(id)));
}
