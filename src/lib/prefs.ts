// Petites préférences locales (pseudo, derniers réglages solo).
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`poker.${key}`);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(`poker.${key}`, JSON.stringify(value));
  } catch {
    /* stockage indisponible */
  }
}

export function loadName(): string {
  try {
    return localStorage.getItem('poker.name') ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem('poker.name', name);
  } catch {
    /* stockage indisponible */
  }
}

export const fmt = (n: number) => n.toLocaleString('fr-FR');
