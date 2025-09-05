const OWNER_IP = process.env.OWNER_IP || "";
const GH_TOKEN = process.env.GITHUB_TOKEN;
const GH_OWNER = process.env.GITHUB_OWNER;
const GH_REPO  = process.env.GITHUB_REPO;
const GH_BRANCH = process.env.GITHUB_BRANCH || "main";
const HOLIDAYS_PATH = process.env.HOLIDAYS_PATH || "data/holidays.json";

const headers = token => ({
  "Authorization": `Bearer ${token}`,
  "User-Agent": "netlify-fn",
  "Accept": "application/vnd.github+json"
});

async function readFromGithub(){
  if(!GH_TOKEN||!GH_OWNER||!GH_REPO) return {json:{}, sha:null, ok:false};
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(HOLIDAYS_PATH)}?ref=${encodeURIComponent(GH_BRANCH)}`;
  const r = await fetch(url, { headers: headers(GH_TOKEN) });
  if(r.status===404) return {json:{}, sha:null, ok:true};
  if(!r.ok){ return {json:{}, sha:null, ok:false, status:r.status, text: await r.text()}; }
  const j = await r.json();
  const content = Buffer.from(j.content||"", "base64").toString("utf8") || "{}";
  let parsed = {};
  try{ parsed = JSON.parse(content); }catch{ parsed = {}; }
  return {json: parsed, sha: j.sha, ok:true};
}

async function writeToGithub(payload, sha){
  if(!GH_TOKEN||!GH_OWNER||!GH_REPO) return {ok:false, error:"Missing GitHub env vars"};
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(HOLIDAYS_PATH)}`;
  const body = {
    message: "Update holidays.json",
    content: Buffer.from(JSON.stringify(payload, null, 2)).toString("base64"),
    branch: GH_BRANCH
  };
  if(sha) body.sha = sha;
  const r = await fetch(url, { method:"PUT", headers: {...headers(GH_TOKEN), "Content-Type":"application/json"}, body: JSON.stringify(body) });
  if(!r.ok) return {ok:false, status:r.status, text: await r.text()};
  return {ok:true};
}

exports.handler = async (event) => {
  const origin = event.headers["origin"] || "";
  const ip = (event.headers["x-forwarded-for"]||"").split(",")[0].trim();
  const method = event.httpMethod;

  if(method === "OPTIONS"){
    return { statusCode: 204, headers: {"Access-Control-Allow-Origin": origin || "*", "Access-Control-Allow-Methods":"GET,POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type"}, body:""};
  }

  if(method === "GET"){
    const r = await readFromGithub();
    if(!r.ok) return { statusCode: 500, body: JSON.stringify({error:"Read failed"}) };
    return { statusCode: 200, headers: {"Cache-Control":"no-store","Content-Type":"application/json","Access-Control-Allow-Origin": origin || "*"}, body: JSON.stringify(r.json) };
  }

  if(method === "POST" || method === "PUT"){
    if(OWNER_IP && OWNER_IP !== ip){
      return { statusCode: 403, headers: {"Access-Control-Allow-Origin": origin || "*"}, body: JSON.stringify({error:"forbidden"}) };
    }
    let payload = {};
    try{ payload = JSON.parse(event.body||"{}"); }catch{}
    // normalize structure
    payload = {
      officialProof: ("officialProof" in payload) ? payload.officialProof : null,
      officialHolidays: Array.isArray(payload.officialHolidays) ? payload.officialHolidays : [],
      specialHolidays: Array.isArray(payload.specialHolidays) ? payload.specialHolidays : []
    };
    const r1 = await readFromGithub();
    const r2 = await writeToGithub(payload, r1.sha);
    if(!r2.ok) return { statusCode: 500, headers: {"Access-Control-Allow-Origin": origin || "*"}, body: JSON.stringify({error:"Write failed"}) };
    return { statusCode: 200, headers: {"Content-Type":"application/json","Access-Control-Allow-Origin": origin || "*"}, body: JSON.stringify(payload) };
  }

  return { statusCode: 405, body: "Method Not Allowed" };
};
