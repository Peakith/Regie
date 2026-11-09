// Leest de lokale Supabase-status en schrijft .env.local met alleen publieke waarden.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const out = execSync('npx supabase status -o json', { encoding: 'utf8' });
const s = JSON.parse(out.slice(out.indexOf('{')));
if (!/127\.0\.0\.1|localhost/.test(s.API_URL)) throw new Error('Dit script is alleen voor de lokale omgeving.');
// Realtime staat lokaal standaard uit (zie supabase/config.toml); de app ververst dan bij focus en elke 30 s.
const realtime = /\[realtime\]\s*\nenabled = true/.test(readFileSync('supabase/config.toml', 'utf8'));
writeFileSync('.env.local', `VITE_SUPABASE_URL=${s.API_URL}\nVITE_SUPABASE_ANON_KEY=${s.ANON_KEY}\nVITE_REALTIME=${realtime ? 'aan' : 'uit'}\n`);
console.log('.env.local geschreven voor', s.API_URL);
