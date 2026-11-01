// Copie le moteur (src/lib/poker) vers supabase/functions/_shared/poker pour l'Edge Function.
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const src = 'src/lib/poker';
const dst = 'supabase/functions/_shared/poker';
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
for (const f of readdirSync(src)) {
  if (f.endsWith('.ts')) cpSync(join(src, f), join(dst, f));
}
console.log(`Moteur copié vers ${dst}`);
