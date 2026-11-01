// Client Supabase du mode en ligne : session anonyme + appels à l'Edge Function « poker ».
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient, FunctionsHttpError } from '@supabase/supabase-js';
import type { PublicRoom } from '../poker/index.ts';

const CONFIG_KEY = 'poker.supabase';

export interface ServerConfig {
  url: string;
  anonKey: string;
}

/** Config : variables d'environnement Vite en priorité, sinon saisie manuelle (stockée localement). */
export function getServerConfig(): ServerConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (url && anonKey) return { url, anonKey };
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? (JSON.parse(raw) as ServerConfig) : null;
  } catch {
    return null;
  }
}

export function saveServerConfig(c: ServerConfig) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
  } catch {
    /* stockage indisponible */
  }
  client = null;
}

export const isEnvConfigured = () => !!import.meta.env.VITE_SUPABASE_URL;

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (client) return client;
  const cfg = getServerConfig();
  if (!cfg) throw new Error('Serveur non configuré.');
  client = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, storageKey: 'poker-auth' },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return client;
}

/** Connexion anonyme (persistée dans le navigateur : on garde le même identifiant au retour). */
export async function ensureSession(): Promise<string> {
  const sb = supabase();
  const { data } = await sb.auth.getSession();
  if (data.session) return data.session.user.id;
  const { data: d2, error } = await sb.auth.signInAnonymously();
  if (error || !d2.user) {
    throw new Error(
      error?.message?.includes('Anonymous')
        ? 'Les connexions anonymes ne sont pas activées sur le projet Supabase.'
        : `Connexion impossible : ${error?.message ?? 'erreur inconnue'}`,
    );
  }
  return d2.user.id;
}

/** Décalage horloge serveur - horloge locale (ms), mis à jour à chaque réponse. */
export let clockOffset = 0;

export interface CallResult {
  code: string;
  roomId: string;
  serverNow: number;
}

export async function call(op: string, payload: Record<string, unknown> = {}): Promise<CallResult> {
  const sent = Date.now();
  const { data, error } = await supabase().functions.invoke('poker', { body: { op, ...payload } });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.json().catch(() => null);
      throw new Error(body?.error ?? 'Erreur serveur.');
    }
    throw new Error("Impossible de joindre le serveur. Vérifie ta connexion.");
  }
  if (data?.serverNow) clockOffset = data.serverNow - (sent + Date.now()) / 2;
  return data as CallResult;
}

export type { PublicRoom };
