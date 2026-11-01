import { useEffect, useState } from 'react';

/** Routage par hash (#/solo, #/room/K7P2QX) : fonctionne sur tout hébergement statique. */
export function useHashRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => setParts(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parts;
}

export function navigate(path: string) {
  window.location.hash = path.startsWith('/') ? path : `/${path}`;
}
