# Quini · duelo de quinielas

Web para llevar el pique de aciertos en La Quiniela entre dos (o más) personas que juegan cada una su columna:

- Cada uno se registra con **email y contraseña** y mete su columna (14 signos + Pleno al 15).
- Los aciertos se actualizan **en directo** mientras se juegan los partidos.
- Al acabar la jornada se aplica el **resultado oficial** y la jornada cuenta para la temporada.
- La página **Temporada** muestra las quinielas ganadas por cada uno (quien más acierta gana, aunque no haya premio), los aciertos totales y la tabla jornada a jornada.

Todo funciona con planes gratuitos: **Supabase** (base de datos, auth, realtime, Edge Functions y cron), **GitHub Pages** (frontend) y **API-Football** (directo, opcional).

## Cómo funciona

| Qué | De dónde sale |
| --- | --- |
| Los 15 partidos de la próxima jornada, con su hora | SELAE: los servicios JSON de loteriasyapuestas.es (`proximosv3` + `fechav3`). Si fallan, se meten a mano pegando 15 líneas `Local - Visitante`. |
| Marcadores en directo | [API-Football](https://www.api-football.com/) (plan gratis, 100 peticiones/día). Los partidos se enlazan por hora de inicio y nombre de los equipos, así que valen también Segunda, selecciones o Liga F. |
| Resultado oficial (signos + pleno) | SELAE (`fechav3`). Publica el signo de cada partido poco después de que acabe, así que se aplica partido a partido y la jornada se cierra al tener los 15. |

Las Edge Functions se ejecutan solas con `pg_cron`:

- **`sync-live`**, cada 5 minutos. Solo llama a API-Football si hay partidos en juego o a punto de empezar, y pide los 15 partidos en una sola petición. La tabla `api_usage` pone un tope diario (90 por defecto).
- **`sync-oficial`**, cada 10 minutos. Solo consulta SELAE si hay una jornada empezada y sin finalizar de la última semana. Aplica cada signo oficial en cuanto se publica y, con los 14 signos y el pleno, marca la jornada como `finalizada`. Antes comprueba que los equipos de SELAE coinciden con los de la jornada, para no aplicar signos a partidos equivocados.
- **`import-jornada`**: se lanza desde la web (Gestión → *Importar próxima jornada*).

Las apuestas se pueden cambiar hasta el inicio del primer partido; lo garantiza RLS en la base de datos, no solo la web. El Pleno al 15 cuenta como un acierto más, así que el máximo son 15. Si empatáis a aciertos, la jornada cuenta como empate.

```
web/                      React + Vite + TypeScript + Tailwind
supabase/migrations/      esquema, vistas, RLS, realtime y cron
supabase/functions/       import-jornada, sync-live, sync-oficial y _shared/
supabase/tests/           tests SQL (pgTAP)
.github/workflows/        despliegue a GitHub Pages
```

## Puesta en marcha

### 1. Proyecto en Supabase

1. Crea un proyecto gratuito en [supabase.com](https://supabase.com).
2. Aplica las migraciones y despliega las funciones desde este repo:

   ```bash
   npx supabase login
   npx supabase link --project-ref <ref-del-proyecto>
   npx supabase db push
   npx supabase functions deploy
   ```

3. Configura la clave de API-Football. Es opcional: sin ella no hay marcadores en directo, pero los resultados oficiales llegan igual por SELAE.

   ```bash
   npx supabase secrets set API_FOOTBALL_KEY=<clave de dashboard.api-football.com>
   # Opcional: tope diario de peticiones (por defecto 90; el plan gratis permite 100)
   npx supabase secrets set API_FOOTBALL_DAILY_LIMIT=90
   ```

   Antes, comprueba que tu plan gratuito cubre la temporada en curso. Si la respuesta trae partidos en `response` y `errors` está vacío, vale:

   ```bash
   curl -s -H "x-apisports-key: <clave>" \
     "https://v3.football.api-sports.io/fixtures?date=$(date +%F)&timezone=Europe/Madrid" | head -c 600
   ```

4. Para activar el cron, guarda en Vault la URL del proyecto y la clave pública (anon / publishable). Ejecútalo en el *SQL Editor*:

   ```sql
   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
   select vault.create_secret('<anon o publishable key>', 'functions_key');
   ```

5. En **Authentication → URL Configuration**, pon como *Site URL* la dirección de GitHub Pages (`https://<usuario>.github.io/quini/`).
6. En **Authentication → Providers → Email**, elige si quieres confirmar el email. Si lo desactivas, el registro es inmediato.
7. Cuando estéis registrados los dos, desactiva **Allow new signups** en *Authentication → Sign In / Providers* para que nadie más pueda entrar.

### 2. Frontend en GitHub Pages

1. En el repositorio de GitHub, ve a **Settings → Secrets and variables → Actions** y añade estos secretos:
   - `VITE_SUPABASE_URL`: `https://<ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY`: la clave anon/publishable, que es pública.
2. En **Settings → Pages → Source**, elige **GitHub Actions**.
3. Haz push a `main`; el workflow `deploy.yml` construye y publica `web/`.

## Uso

1. **Gestión → Importar próxima jornada** crea la jornada con sus 15 partidos y los enlaza con API-Football. Si algún partido no se enlaza, puedes poner su *fixture* a mano o meter el resultado directamente.
2. Cada uno entra en **Jornada → Hacer mi apuesta**.
3. Durante la jornada, la página se actualiza sola. Los aciertos aparecen en verde claro mientras son provisionales y en verde sólido cuando el partido termina.
4. Según acaba cada partido, `sync-oficial` aplica su signo oficial de SELAE. Con los 15 resultados, la jornada se cierra y suma en **Temporada**. También puedes forzarlo con *Traer resultado oficial* o corregir cualquier dato en Gestión.

## Desarrollo local

Requiere Docker.

```bash
npx supabase start                  # Postgres, Auth, Realtime… en local
npx supabase functions serve        # Edge Functions (secretos en supabase/functions/.env)
cd web && cp .env.example .env.local   # pon la URL y la clave que imprime `supabase start`
npm install && npm run dev
```

Tests:

```bash
npx supabase test db                      # SQL: aciertos, pleno, clasificación y RLS
npx deno test supabase/functions/_shared  # parsers de SELAE y cruce de equipos
cd web && npm run build                   # typecheck + build
```

## Limitaciones conocidas

- SELAE no tiene una API pública: se usan los mismos servicios que su web, que podrían cambiar o bloquear peticiones. Si pasa, se pueden dar de alta las jornadas y meter los resultados a mano en Gestión.
- Hay que comprobar que el plan gratuito de API-Football da acceso a la temporada en curso. Si no, el directo no funcionará, aunque sí los resultados oficiales.
