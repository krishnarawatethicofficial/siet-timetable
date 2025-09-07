const OWNER_IP=process.env.OWNER_IP||"";
const GH_TOKEN=process.env.GITHUB_TOKEN;
const GH_OWNER=process.env.GITHUB_OWNER;
const GH_REPO=process.env.GITHUB_REPO;
const GH_BRANCH=process.env.GITHUB_BRANCH||"main";
const HOLIDAYS_PATH=process.env.HOLIDAYS_PATH||"data/holidays.json";
const ALLOW_EMAILS=(process.env.ALLOW_EMAILS||"").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
const ALLOW_ROLES=(process.env.ALLOW_ROLES||"").split(",").map(s=>s.trim()).filter(Boolean);
const ADMIN_KEY=process.env.ADMIN_KEY||"";

const headers=t=>({"Authorization":`Bearer ${t}`,"User-Agent":"netlify-fn","Accept":"application/vnd.github+json"});
const cors=(o)=>({"Access-Control-Allow-Origin":o||"*","Access-Control-Allow-Methods":"GET,POST,PUT,OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization, X-API-Key"});
const json=(code,obj,o)=>({statusCode:code,headers:{"Content-Type":"application/json",...cors(o)},body:JSON.stringify(obj)});

function uEmail(u){return u&&(u.email||(u.app_metadata&&u.app_metadata.email));}
function uRoles(u){return (u&&u.app_metadata&&u.app_metadata.roles)||[];}
function isAuthorized(event,context){
  const origin=event.headers["origin"]||"";
  const ip=(event.headers["x-forwarded-for"]||"").split(",")[0].trim();
  if(ADMIN_KEY && (event.headers["x-api-key"]===ADMIN_KEY)) return {ok:true, via:"api-key", origin};
  if(OWNER_IP && OWNER_IP===ip) return {ok:true, via:"ip", origin};
  const user=context.clientContext&&context.clientContext.user;
  if(!user) return {ok:false, origin, reason:"auth required"};
  const email=String(uEmail(user)||"").toLowerCase();
  const roles=uRoles(user);
  const allowListEmpty=(ALLOW_EMAILS.length===0&&ALLOW_ROLES.length===0);
  if(allowListEmpty||ALLOW_EMAILS.includes(email)||ALLOW_ROLES.some(r=>roles.includes(r))) return {ok:true, via:"identity", origin, email};
  return {ok:false, origin, reason:"forbidden"};
}

async function readFromGithub(){
  if(!GH_TOKEN||!GH_OWNER||!GH_REPO) return {json:{},sha:null,ok:false};
  const url=`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(HOLIDAYS_PATH)}?ref=${encodeURIComponent(GH_BRANCH)}`;
  const r=await fetch(url,{headers:headers(GH_TOKEN)});
  if(r.status===404) return {json:{},sha:null,ok:true};
  if(!r.ok) return {json:{},sha:null,ok:false,status:r.status,text:await r.text()};
  const j=await r.json();
  const content=Buffer.from(j.content||"","base64").toString("utf8")||"{}";
  let parsed={};try{parsed=JSON.parse(content)}catch{parsed={}};
  return {json:parsed,sha:j.sha,ok:true};
}

async function writeToGithub(payload,sha,who){
  if(!GH_TOKEN||!GH_OWNER||!GH_REPO) return {ok:false,error:"Missing GitHub env vars"};
  const url=`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(HOLIDAYS_PATH)}`;
  const body={message:`Update holidays.json (${who||"unknown"})`,content:Buffer.from(JSON.stringify(payload,null,2)).toString("base64"),branch:GH_BRANCH};
  if(sha) body.sha=sha;
  const r=await fetch(url,{method:"PUT",headers:{...headers(GH_TOKEN),"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(!r.ok) return {ok:false,status:r.status,text:await r.text()};
  return {ok:true};
}

exports.handler=async(event,context)=>{
  const origin=event.headers["origin"]||"";
  const method=event.httpMethod;

  if(method==="OPTIONS") return {statusCode:204,headers:cors(origin),body:""};

  if(method==="GET"){
    const r=await readFromGithub();
    if(!r.ok) return json(500,{error:"Read failed"},origin);
    return {statusCode:200,headers:{"Cache-Control":"no-store","Content-Type":"application/json",...cors(origin)},body:JSON.stringify(r.json)};
  }

  if(method==="POST"||method==="PUT"){
    const auth=isAuthorized(event,context);
    if(!auth.ok) return json(auth.reason==="auth required"?401:403,{error:auth.reason},origin);
    let payload={};try{payload=JSON.parse(event.body||"{}")}catch{payload={}};
    payload={officialProof:("officialProof" in payload)?payload.officialProof:null,officialHolidays:Array.isArray(payload.officialHolidays)?payload.officialHolidays:[],specialHolidays:Array.isArray(payload.specialHolidays)?payload.specialHolidays:[]};
    const r1=await readFromGithub();
    const who=(auth.email||auth.via);
    const r2=await writeToGithub(payload,r1.sha,who);
    if(!r2.ok) return json(500,{error:"Write failed",status:r2.status||0},origin);
    return json(200,payload,origin);
  }

  return {statusCode:405,headers:cors(origin),body:"Method Not Allowed"};
};
