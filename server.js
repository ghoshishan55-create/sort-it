const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const db = require("./db");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "ghoshishan55@gmail.com").trim().toLowerCase();
const ROOT = __dirname;
const UPLOAD_DIR = path.join(ROOT, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.disable("x-powered-by");
app.use(express.json({ limit:"1mb" }));
app.use(express.urlencoded({ extended:true, limit:"1mb" }));

const allowedMimeTypes = new Set(["image/jpeg","image/png","image/webp","video/mp4","video/webm","video/quicktime"]);
const storage = multer.diskStorage({
  destination: (_req,_file,cb)=>cb(null,UPLOAD_DIR),
  filename: (_req,file,cb)=>{
    const ext=path.extname(file.originalname).toLowerCase();
    cb(null,`${Date.now()}-${crypto.randomUUID()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits:{files:5,fileSize:20*1024*1024},
  fileFilter:(_req,file,cb)=>allowedMimeTypes.has(file.mimetype) ? cb(null,true) : cb(new Error("Only JPG, PNG, WEBP, MP4, WEBM and MOV files are allowed."))
});

app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(ROOT,{index:"index.html"}));

function cleanIssue(row){
  return {id:row.id,title:row.title,category:row.category,description:row.description,location:row.location,date:row.date,ongoing:Boolean(row.ongoing),name:row.name||"",votes:row.votes,comments:0,status:row.status,createdAt:row.created_at,evidence:JSON.parse(row.evidence||"[]")};
}
function validText(value,max){ return typeof value==="string" && value.trim().length>0 && value.trim().length<=max; }

function hashPassword(password,salt){
  return new Promise((resolve,reject)=>crypto.scrypt(password,salt,64,(err,key)=>err?reject(err):resolve(`${salt}:${key.toString("hex")}`)));
}
function verifyPassword(password,stored){
  const [salt,keyHex]=String(stored).split(":");
  return new Promise((resolve,reject)=>crypto.scrypt(password,salt,64,(err,key)=>{
    if(err)return reject(err);
    const a=Buffer.from(keyHex,"hex"), b=Buffer.from(key);
    resolve(a.length===b.length && crypto.timingSafeEqual(a,b));
  }));
}
function parseCookies(req){
  return Object.fromEntries((req.headers.cookie||"").split(";").filter(Boolean).map(x=>{
    const i=x.indexOf("="); return [x.slice(0,i).trim(),decodeURIComponent(x.slice(i+1))];
  }));
}
function currentUser(req){ const token=parseCookies(req).sortit_session; return token ? db.getUserBySession(token) : null; }
function setSession(res,token){
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie",`sortit_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`);
}
function isAdmin(user){ return Boolean(user && user.email && user.email.toLowerCase() === ADMIN_EMAIL); }
function requireAdmin(req,res,next){
  const user=currentUser(req);
  if(!user || !isAdmin(user)) return res.status(403).json({error:"Administrator access required."});
  req.adminUser=user; next();
}

app.get("/api/health",(_req,res)=>res.json({ok:true,service:"Sort-it API"}));

app.post("/api/auth/register",async(req,res)=>{
  try{
    const name=String(req.body.name||"").trim(), email=String(req.body.email||"").trim().toLowerCase(), password=String(req.body.password||"");
    if(!validText(name,100)) return res.status(400).json({error:"Enter your name."});
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:"Enter a valid email."});
    if(password.length<8 || password.length>200) return res.status(400).json({error:"Password must be at least 8 characters."});
    if(db.getUserByEmail(email)) return res.status(409).json({error:"An account with this email already exists."});
    const passwordHash=await hashPassword(password,crypto.randomBytes(16).toString("hex"));
    const result=db.createUser(name,email,passwordHash);
    const token=crypto.randomBytes(32).toString("hex");
    db.createSession(token,result.lastInsertRowid); setSession(res,token);
    res.status(201).json({user:{...db.getUserById(result.lastInsertRowid),isAdmin:isAdmin(db.getUserById(result.lastInsertRowid))}});
  }catch(e){console.error(e);res.status(500).json({error:"Could not create the account."});}
});

app.post("/api/auth/login",async(req,res)=>{
  try{
    const email=String(req.body.email||"").trim().toLowerCase(), password=String(req.body.password||"");
    const user=db.getUserByEmail(email);
    if(!user || !(await verifyPassword(password,user.password_hash))) return res.status(401).json({error:"Invalid email or password."});
    const token=crypto.randomBytes(32).toString("hex");
    db.createSession(token,user.id); setSession(res,token);
    res.json({user:{...db.getUserById(user.id),isAdmin:isAdmin(user)}});
  }catch(e){console.error(e);res.status(500).json({error:"Login failed."});}
});
app.get("/api/auth/me",(req,res)=>{
  const user=currentUser(req);
  if(!user)return res.json({user:null});
  res.json({user:user ? {...user,isAdmin:isAdmin(user)} : null});
});
app.post("/api/auth/logout",(req,res)=>{
  const token=parseCookies(req).sortit_session;
  if(token)db.deleteSession(token);
  res.setHeader("Set-Cookie","sortit_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.json({ok:true});
});

app.get("/api/issues",(req,res)=>{
  const category=typeof req.query.category==="string"?req.query.category:"all";
  const search=typeof req.query.search==="string"?req.query.search.trim():"";
  const rows=db.prepare(`SELECT * FROM issues WHERE (?='all' OR category=?) AND (?='' OR lower(title||' '||category||' '||location||' '||description) LIKE lower(?)) ORDER BY votes DESC,created_at DESC`)
    .all(category,category,search,`%${search}%`);
  res.json(rows.map(cleanIssue));
});

app.post("/api/issues",upload.array("evidence",5),(req,res)=>{
  try{
    const {title,category,description,location,date,ongoing,name,phone}=req.body;
    if(!validText(title,100))return res.status(400).json({error:"A valid issue title is required."});
    if(!validText(category,50))return res.status(400).json({error:"A category is required."});
    if(!validText(description,1000))return res.status(400).json({error:"A valid description is required."});
    if(!validText(location,200))return res.status(400).json({error:"A location is required."});
    const evidence=(req.files||[]).map(file=>({filename:file.filename,originalName:file.originalname,mimeType:file.mimetype,url:`/uploads/${file.filename}`}));
    const result=db.prepare(`INSERT INTO issues(title,category,description,location,date,ongoing,name,phone,evidence,status) VALUES(?,?,?,?,?,?,?,?,?,'Reported')`)
      .run(title.trim(),category.trim(),description.trim(),location.trim(),date||null,ongoing==="Yes"?1:0,typeof name==="string"?name.trim().slice(0,100):"",typeof phone==="string"?phone.trim().slice(0,20):"",JSON.stringify(evidence));
    res.status(201).json(cleanIssue(db.prepare("SELECT * FROM issues WHERE id=?").get(result.lastInsertRowid)));
  }catch(e){console.error(e);res.status(500).json({error:"Could not save the issue."});}
});

app.post("/api/issues/:id/vote",(req,res)=>{
  const issueId=Number(req.params.id), user=currentUser(req);
  const voterId=user?`user:${user.id}`:(typeof req.get("X-Voter-Id")==="string"?req.get("X-Voter-Id").trim():"");
  if(!Number.isInteger(issueId)||!voterId||voterId.length>120)return res.status(400).json({error:"A valid issue and voter identity are required."});
  try{res.json(db.voteIssue(issueId,voterId));}
  catch(e){if(e.code==="ALREADY_VOTED")return res.status(409).json({error:"You have already supported this issue."});if(e.code==="NOT_FOUND")return res.status(404).json({error:"Issue not found."});console.error(e);res.status(500).json({error:"Could not record the vote."});}
});

app.get("/api/polls",(_req,res)=>res.json(db.getPolls()));
app.post("/api/polls/:id/vote",(req,res)=>{
  const pollId=Number(req.params.id), optionIndex=Number(req.body.optionIndex), user=currentUser(req);
  const voterId=user?`user:${user.id}`:(typeof req.get("X-Voter-Id")==="string"?req.get("X-Voter-Id").trim():"");
  if(!Number.isInteger(pollId)||!voterId||!Number.isInteger(optionIndex))return res.status(400).json({error:"Invalid poll vote."});
  try{res.json(db.votePoll(pollId,optionIndex,voterId));}
  catch(e){if(e.code==="NOT_FOUND")return res.status(404).json({error:"Poll or option not found."});console.error(e);res.status(500).json({error:"Could not record the poll vote."});}
});


app.get("/api/admin/issues",requireAdmin,(req,res)=>{
  const rows=db.prepare("SELECT * FROM issues ORDER BY CASE WHEN status='Reported' THEN 0 ELSE 1 END, votes DESC, created_at DESC").all();
  res.json(rows.map(cleanIssue));
});
app.patch("/api/admin/issues/:id/status",requireAdmin,(req,res)=>{
  const id=Number(req.params.id), status=String(req.body.status||"").trim();
  if(!Number.isInteger(id) || !["Reported","Resolved"].includes(status))
    return res.status(400).json({error:"Invalid issue status."});
  const result=db.prepare("UPDATE issues SET status=? WHERE id=?").run(status,id);
  if(!result.changes)return res.status(404).json({error:"Issue not found."});
  res.json({ok:true,issue:cleanIssue(db.prepare("SELECT * FROM issues WHERE id=?").get(id))});
});

app.get("/api/stats",(_req,res)=>res.json(db.getStats()));

app.use((error,_req,res,_next)=>{
  if(error instanceof multer.MulterError)return res.status(400).json({error:error.code==="LIMIT_FILE_SIZE"?"Each file must be 20 MB or smaller.":error.message});
  if(error)return res.status(400).json({error:error.message||"Request failed."});
  res.status(500).json({error:"Server error."});
});

app.listen(PORT,"0.0.0.0",()=>console.log(`Sort-it running on port ${PORT}`));
