// Borra la cuenta del usuario que hace la petición.
//
//   POST { "confirmacion": "BORRAR" }
//
// Borrar un usuario de Supabase Auth necesita la service role, por eso va en una
// Edge Function. El perfil y las apuestas se borran en cascada (on delete cascade).
import { adminClient, usuarioDe } from "../_shared/supabase.ts";
import { corsHeaders, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);

  const usuario = await usuarioDe(req);
  if (!usuario) return json({ ok: false, error: "No autenticado" }, 401);

  const body = await req.json().catch(() => ({}));
  if (body?.confirmacion !== "BORRAR") {
    return json({ ok: false, error: 'Falta la confirmación: escribe "BORRAR".' }, 400);
  }

  try {
    const { error } = await adminClient().auth.admin.deleteUser(usuario.id);
    if (error) throw error;
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
