# Mito CRM

CRM propio de gestión de trabajo (tableros, grupos, elementos y columnas tipadas), cargado con los
datos del espacio de trabajo exportados desde monday.com por su API oficial.

## Qué incluye

- **Espacios y tableros** con grupos de color, plegables.
- **Columnas**: texto, números (con unidad y suma), estado, desplegable, personas, fecha, hora,
  e-mail, teléfono, enlace, casilla y última actualización. Se agregan, renombran, redimensionan,
  ocultan y eliminan; las etiquetas de estado/desplegable se editan en el lugar.
- **Vistas** por tablero: tabla, Kanban (arrastrar entre estados), calendario (arrastrar entre días),
  cronograma y gráfico. Cada vista guarda su filtro, orden, persona y columnas ocultas.
- **Elementos**: edición en línea, subelementos, reordenar arrastrando, selección múltiple
  (duplicar / mover / eliminar), panel con actualizaciones, campos y registro de actividad.
- Búsqueda global, exportación a CSV y sincronización en tiempo real entre usuarios (SSE).

## Uso

Requiere Node.js 22.13 o superior.

```bash
npm install
npm run build
npm start          # http://localhost:3001
```

Desarrollo con recarga: `npm run dev` (interfaz en http://localhost:5173).

### Importar desde monday.com

```bash
MONDAY_API_TOKEN=xxx npm run fetch-monday   # genera data/monday-export.json
npm run import -- --reset                   # carga la base (borra lo anterior)
```

Sin `--reset` la importación actualiza por ID y conserva lo creado en la app.

## Configuración

| Variable       | Uso                                                              |
| -------------- | ---------------------------------------------------------------- |
| `PORT`         | Puerto del servidor (3001 por defecto)                           |
| `DB_PATH`      | Archivo SQLite (`data/crm.db` por defecto)                       |
| `APP_PASSWORD` | Si se define, la app pide esta contraseña compartida para entrar |

Los datos viven en un único archivo SQLite: hay que desplegar en un host con disco persistente
(VPS, Railway, Render, Fly.io) y respaldar `data/crm.db`. La base y el export están en `.gitignore`.

## Estructura

- `server/` — API Express + SQLite (`node:sqlite`), eventos en tiempo real.
- `src/` — interfaz React + TypeScript (Vite).
- `scripts/` — exportación e importación desde monday.com.
