// Importa un export de monday.com (ver scripts/fetch-monday.js) a la base SQLite.
// Uso: node scripts/import-monday.js [ruta-al-export.json] [--reset]
import { readFileSync } from 'node:fs';
import { importDump } from '../server/import.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--')) || 'data/monday-export.json';
const r = importDump(JSON.parse(readFileSync(file, 'utf8')), { reset: args.includes('--reset') });
console.log(`Importado: ${r.users} usuarios, ${r.workspaces} espacios, ${r.boards} tableros, ${r.items} elementos, ${r.updates} actualizaciones`);
