const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("SUPABASE_URL und SUPABASE_KEY müssen als Environment Variables gesetzt sein.");
  process.exit(1);
}
if (!ADMIN_KEY) {
  console.error("ADMIN_KEY muss als Environment Variable gesetzt sein.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

app.use(express.json({ limit: "100kb" }));
app.use(express.static("public"));

app.post("/api/rsvp", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const attending = req.body.attending === true;
    const guests = Array.isArray(req.body.guests)
      ? req.body.guests.map(x => String(x).trim()).filter(Boolean).slice(0, 20) : [];
    const email = String(req.body.email || "").trim();

    if (!name) return res.status(400).json({ error: "Bitte deinen Namen eintragen." });
    if (typeof req.body.attending !== "boolean")
      return res.status(400).json({ error: "Bitte auswählen, ob du kommst." });
    if (!attending && guests.length)
      return res.status(400).json({ error: "Gäste können nur eingetragen werden, wenn du kommst." });
    if (attending && !email) return res.status(400).json({ error: "Bitte deine E-Mail-Adresse eingeben." });
    if (attending && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: "Bitte eine gültige E-Mail-Adresse eingeben." });

    const { error } = await supabase.from("responses").insert({
      name, attending, guests, email
    });

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Die Anmeldung konnte nicht gespeichert werden." });
    }

    // Send a notification to the organizer. The RSVP remains successful
    // even if the notification email cannot be sent.
    if (resend && NOTIFICATION_EMAIL) {
      const guestText = guests.length ? guests.map(g => `• ${g}`).join("\n") : "Keine Begleitpersonen";
      const statusText = attending ? "kommt" : "kommt leider nicht";
      try {
        await resend.emails.send({
          from: "Pirovino Treffen <onboarding@resend.dev>",
          to: [NOTIFICATION_EMAIL],
          subject: `Pirovino Treffen – ${name} ${attending ? "kommt" : "kommt leider nicht"}`,
          text:
`Neue Rückmeldung zum Pirovino Treffen

${name} ${statusText}.

Begleitpersonen:
${guestText}

E-Mail: ${email || "keine E-Mail angegeben"}

Datum: Samstag, 12. Juni 2027
Ort: Mörsburg, Winterthur`
        });
      } catch (mailError) {
        console.error("Resend notification failed:", mailError);
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Die Anmeldung konnte nicht gespeichert werden." });
  }
});

function authorized(req) {
  return req.query.key && req.query.key === ADMIN_KEY;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
function csv(res, filename, rows) {
  const out = rows.map(row => row.map(v => `"${String(v ?? "").replace(/"/g,'""')}"`).join(",")).join("\n");
  res.setHeader("Content-Type","text/csv; charset=utf-8");
  res.setHeader("Content-Disposition",`attachment; filename=${filename}`);
  res.send("\uFEFF"+out);
}

app.get("/admin", async (req, res) => {
  if (!authorized(req)) return res.status(401).send("Nicht autorisiert.");
  const { data, error } = await supabase.from("responses").select("*").order("created_at", {ascending:false});
  if (error) return res.status(500).send("Daten konnten nicht geladen werden.");
  const rows=data || [];
  const attending=rows.filter(r=>r.attending);
  const total=attending.reduce((sum,r)=>sum+1+(Array.isArray(r.guests)?r.guests.length:0),0);
  res.send(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pirovino Treffen – Verwaltung</title><style>
body{font-family:system-ui,sans-serif;max-width:950px;margin:40px auto;padding:0 20px;color:#222}
h1{font-size:30px}.stats{display:flex;gap:20px;flex-wrap:wrap;margin:25px 0}
.stat{border:1px solid #ddd;border-radius:14px;padding:18px;min-width:150px}.n{font-size:30px;font-weight:700}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px;border-bottom:1px solid #eee;vertical-align:top}
a{display:inline-block;padding:12px 16px;border:1px solid #222;border-radius:10px;text-decoration:none;color:#222;margin:0 8px 20px 0}
</style></head><body><h1>Pirovino Treffen</h1>
<p>Samstag, 12. Juni 2027 · Mörsburg, Winterthur</p>
<div class="stats"><div class="stat"><div class="n">${total}</div>Personen kommen</div>
<div class="stat"><div class="n">${attending.length}</div>Anmeldungen</div>
<div class="stat"><div class="n">${rows.length}</div>Rückmeldungen</div></div>
<a href="/admin.csv?key=${encodeURIComponent(ADMIN_KEY)}">Gästeliste als CSV</a>
<a href="/emails.csv?key=${encodeURIComponent(ADMIN_KEY)}">Mailingliste als CSV</a>
<table><thead><tr><th>Name</th><th>Kommt</th><th>Gäste</th><th>E-Mail</th><th>Zeitpunkt</th></tr></thead><tbody>
${rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.attending?"Ja":"Nein"}</td><td>${(Array.isArray(r.guests)?r.guests:[]).map(esc).join("<br>")||"–"}</td><td>${esc(r.email)}</td><td>${esc(r.created_at)}</td></tr>`).join("")}
</tbody></table></body></html>`);
});

app.get("/admin.csv", async (req,res)=>{
  if (!authorized(req)) return res.status(401).send("Nicht autorisiert.");
  const {data,error}=await supabase.from("responses").select("*").order("created_at",{ascending:false});
  if(error)return res.status(500).send("Fehler");
  csv(res,"pirovino-gaesteliste.csv",[["Name","Kommt","Gäste","E-Mail","Zeitpunkt"],...(data||[]).map(r=>[r.name,r.attending?"Ja":"Nein",(r.guests||[]).join("; "),r.email,r.created_at])]);
});
app.get("/emails.csv", async (req,res)=>{
  if (!authorized(req)) return res.status(401).send("Nicht autorisiert.");
  const {data,error}=await supabase.from("responses").select("email");
  if(error)return res.status(500).send("Fehler");
  const emails=[...new Set((data||[]).map(r=>r.email).filter(Boolean))].sort();
  csv(res,"pirovino-mailingliste.csv",[["E-Mail"],...emails.map(e=>[e])]);
});

app.listen(PORT,()=>console.log(`Pirovino Treffen läuft auf Port ${PORT}`));
