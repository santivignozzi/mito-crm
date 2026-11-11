// Descarga un export fresco desde la API de monday.com.
// Uso: MONDAY_API_TOKEN=xxx node scripts/fetch-monday.js [salida.json]
import { writeFileSync } from 'node:fs';

const token = process.env.MONDAY_API_TOKEN;
if (!token) {
  console.error('Falta MONDAY_API_TOKEN (monday > Avatar > Developers > My access tokens)');
  process.exit(1);
}
const out = process.argv[2] || 'data/monday-export.json';

async function gql(query, variables = {}) {
  const r = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token, 'API-Version': '2025-04' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

const ITEM = `id name created_at updated_at group{id} column_values{id text value}
  subitems{ id name created_at updated_at column_values{id text value} }
  updates(limit:50){ id text_body created_at creator{id name} }`;

const { users, workspaces } = await gql(`query { users(limit:200){ id name email title } workspaces(limit:100){ id name description } }`);
const boards = [];
for (let page = 1; ; page++) {
  const d = await gql(
    `query($page:Int!){ boards(limit:25, page:$page){ id name description type workspace_id items_count
      groups{id title color position archived} columns{id title type settings_str archived width} views{id name type settings_str}
      items_page(limit:500){ cursor items{ ${ITEM} } } } }`,
    { page },
  );
  if (!d.boards.length) break;
  for (const b of d.boards) {
    let cursor = b.items_page.cursor;
    while (cursor) {
      const n = await gql(`query($c:String!){ next_items_page(limit:500, cursor:$c){ cursor items{ ${ITEM} } } }`, { c: cursor });
      b.items_page.items.push(...n.next_items_page.items);
      cursor = n.next_items_page.cursor;
    }
    b.items_page.cursor = null;
    boards.push(b);
  }
}
const wsIds = new Set(boards.map((b) => String(b.workspace_id)));
writeFileSync(out, JSON.stringify({ users, workspaces: workspaces.filter((w) => wsIds.has(String(w.id))), boards }));
console.log(`Guardado ${out}: ${boards.length} tableros`);
