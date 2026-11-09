// Leest de lokale Supabase-status en schrijft .env.local met alleen publieke waarden.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const out = execSync('npx supabase status -o json', { encoding: 'utf8' });
const s = JSON.parse(out.slice(out.indexOf('{')));
if (!/127\.0\.0\.1|localhost/.test(s.API_URL)) throw new Error('Dit script is alleen voor de lokale omgeving.');
writeFileSync('.env.local', `VITE_SUPABASE_URL=${s.API_URL}\nVITE_SUPABASE_ANON_KEY=${s.ANON_KEY}\n`);
console.log('.env.local geschreven voor', s.API_URL);
