// Aura AI backend (Cloudflare Worker)
// Cloudflare me ye 4 cheezein daalni hain (Settings -> Variables and Secrets):
//   GEMINI_KEY          -> Gemini API key            (type: Secret)
//   FIREBASE_API_KEY    -> Firebase Web API key      (type: Text)
//   FIREBASE_PROJECT_ID -> aura-ai-5ad5e             (type: Text)
//   ALLOWED_ORIGIN      -> https://USERNAME.github.io (type: Text, bina / ke)

export default {
  async fetch(req, env) {
    const allowed = env.ALLOWED_ORIGIN || '';
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': allowed,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin'
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (!allowed || origin !== allowed) return json({ error: { message: 'Origin allowed nahi hai' } }, 403);
    if (req.method !== 'POST') return json({ error: { message: 'Sirf POST chalega' } }, 405);

    const path = new URL(req.url).pathname;
    if (!/^\/models\/[\w.\-]+:generateContent$/.test(path)) {
      return json({ error: { message: 'Galat path' } }, 404);
    }

    // 1) Firebase login check
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: { message: 'Pehle login karo' } }, 401);
    const chk = await fetch(
      'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + env.FIREBASE_API_KEY,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }) }
    );
    if (!chk.ok) return json({ error: { message: 'Login expire ho gaya, dobara login karo' } }, 401);
    const uid = ((await chk.json()).users || [])[0]?.localId;
    if (!uid) return json({ error: { message: 'User nahi mila' } }, 401);

    // 2) Block check (Firestore users/{uid}.blocked)
    const fs = await fetch(
      'https://firestore.googleapis.com/v1/projects/' + env.FIREBASE_PROJECT_ID + '/databases/(default)/documents/users/' + uid,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    if (fs.ok) {
      const d = await fs.json();
      if (d.fields && d.fields.blocked && d.fields.blocked.booleanValue === true) {
        return json({ error: { message: 'Aapka account block hai' } }, 403);
      }
    }

    // 3) Gemini ko request bhejo (key yahin chhupi hai)
    const body = await req.text();
    if (body.length > 25 * 1024 * 1024) return json({ error: { message: 'File bahut badi hai' } }, 413);
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY },
      body
    });
    return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
};
