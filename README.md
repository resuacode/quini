# Quini · duelo de quinielas

Web para llevar el pique de aciertos en La Quiniela entre dos (o más) personas que juegan cada una su columna:

- Cada uno se registra con **email y contraseña** y mete su columna (14 signos + Pleno al 15).
- Los aciertos se actualizan **en directo** mientras se juegan los partidos.
- Al acabar la jornada, esta cuenta para la temporada y se contrasta con el **resultado oficial**.
- La página **Temporada** muestra las quinielas ganadas por cada uno (quien más acierta gana, aunque no haya premio), los aciertos totales y la tabla jornada a jornada.

Todo funciona con planes gratuitos: **Supabase** (base de datos, auth, realtime, Edge Functions y cron), **GitHub Pages** (frontend), **API-Football** (directo) y **loteriasapi.com** (resultado oficial).

## Cómo funciona

| Qué | De dónde sale |
| --- | --- |
| Los 15 partidos de la jornada | Se pegan en **Gestión**, copiados de cualquier sitio (p. ej. loteriasyapuestas.es). El formulario reconoce número de jornada, número de partido, fecha, hora y marcas `(m)`/`(f)`, y enseña una vista previa. |
| Marcadores en directo | [API-Football](https://www.api-football.com/) (plan gratis, 100 peticiones/día). Los partidos se enlazan por hora de inicio y nombre de los equipos, así que valen también Segunda, selecciones o Liga F. |
| Cierre de la jornada | Automático cuando API-Football da los 15 partidos por terminados. |
| Resultado oficial (aplazados, partidos sin enlazar) | [loteriasapi.com](https://loteriasapi.com), consultado pocas veces por jornada. Como intento extra se prueba SELAE, aunque bloquea las peticiones desde Supabase. |

Las Edge Functions se ejecutan solas con `pg_cron`:

- **`sync-live`**, cada 5 minutos. Solo llama a API-Football si hay partidos en juego o a punto de empezar, y pide los 15 partidos en una sola petición. La tabla `api_usage` pone un tope diario (90 por defecto).
- **`sync-oficial`**, cada 10 minutos:
  - Cierra la jornada en cuanto API-Football da los 15 partidos por terminados.
  - Cuando la jornada ha acabado, pide el resultado oficial a loteriasapi, como mucho una vez cada 3 horas y con un tope diario de 4 peticiones. Solo sigue intentándolo durante la semana siguiente a la jornada.
  - Antes de aplicar los signos, comprueba que los equipos coinciden con los de la jornada.
- **`import-jornada`**: enlaza los partidos de una jornada con API-Football. Se lanza sola al crear la jornada y con el botón *Enlazar con API-Football*.

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

3. Configura las claves de las APIs. Las dos son opcionales:
   - Sin API-Football no hay directo, y los resultados se meten a mano en Gestión.
   - Sin loteriasapi, la jornada se cierra igual con los resultados de API-Football, pero sin confirmación oficial.

   ```bash
   npx supabase secrets set API_FOOTBALL_KEY=<clave de dashboard.api-football.com>
   npx supabase secrets set LOTERIAS_API_KEY=<clave de loteriasapi.com>
   # Opcional: topes diarios (por defecto 90 y 4)
   npx supabase secrets set API_FOOTBALL_DAILY_LIMIT=90 LOTERIAS_API_DAILY_LIMIT=4
   ```

   Antes, comprueba que el plan gratuito de API-Football cubre la temporada en curso. Si la respuesta trae partidos en `response` y `errors` está vacío, vale:

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

1. En **Gestión → Nueva jornada**, pega los 15 partidos, revisa la vista previa y pulsa *Crear jornada*. Se enlazan solos con API-Football. Si alguno no se enlaza, puedes poner su *fixture* a mano o meter el resultado directamente.
2. Cada uno entra en **Jornada → Hacer mi apuesta**.
3. Durante la jornada, la página se actualiza sola. Los aciertos aparecen en verde claro mientras son provisionales y en verde sólido cuando el partido termina.
4. Cuando acaban los 15 partidos, la jornada se cierra y suma en **Temporada**. Después se contrasta con el resultado oficial; puedes forzarlo con *Traer resultado oficial* o corregir cualquier dato en Gestión.

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
npx deno test supabase/functions/_shared  # parser de resultados y cruce de equipos
cd web && npm run build                   # typecheck + build
```

## Limitaciones conocidas

- SELAE (loteriasyapuestas.es) no tiene una API pública y bloquea las peticiones que salen de servidores como los de Supabase, por eso los partidos de cada jornada se pegan a mano.
- La documentación de loteriasapi.com no concreta el formato de respuesta de la quiniela ni la cuota gratuita, así que el parser acepta varias formas y las consultas están muy espaciadas.
- Hay que comprobar que el plan gratuito de API-Football da acceso a la temporada en curso. Si no, no hay directo ni cierre automático: los resultados se meten a mano o llegan con loteriasapi.
