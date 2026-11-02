import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {Game} from './game.js';
const rooms=new Map(),rates=new Map(),TTL=24*60*60*1000,MAX_ROOMS=250;
const makeToken=()=>randomBytes(24).toString('hex');
function json(res,status,data){if(res.headersSent)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
async function body(req){let chunks=[],size=0;for await(let c of req){size+=c.length;if(size>12000)throw Error('Слишком большой запрос');chunks.push(c)}return size?JSON.parse(Buffer.concat(chunks).toString('utf8')):{}}
function state(r,p){return{room:r.id,you:p,ready:!!r.tokens[1],online:r.clients.map(c=>c.size>0),game:r.game.view()}}
function send(r){for(let p=0;p<2;p++)for(let res of r.clients[p])if(!res.destroyed)res.write('data: '+JSON.stringify(state(r,p))+'\n\n')}
function auth(req,r,u){let token=req.headers.authorization?.replace(/^Bearer /,'')||u.searchParams.get('token');let p=r.tokens.indexOf(token);if(!token||p<0)throw Error('Ключ игрока не найден. Вернитесь в том же браузере.');return p}
function allowed(req){let origin=req.headers.origin;if(!origin)return true;try{return new URL(origin).host===req.headers.host}catch{return false}}
const server=http.createServer(async(req,res)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Cache-Control','no-store');let u=new URL(req.url,'http://localhost');try{
if(req.method==='GET'&&u.pathname==='/health'){res.writeHead(200,{'Content-Type':'text/plain'});res.end('ok');return}
if(req.method==='GET'&&u.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(await readFile(new URL('./public/index.html',import.meta.url)));return}
if(req.method==='POST'&&!allowed(req)){json(res,403,{error:'Запрос с другого сайта запрещён'});return}
if(req.method==='POST'&&u.pathname==='/api/rooms'){let ip=req.socket.remoteAddress,now=Date.now(),rate=(rates.get(ip)||[]).filter(t=>now-t<60000);if(rate.length>=10)return json(res,429,{error:'Подождите минуту перед созданием новой комнаты'});rate.push(now);rates.set(ip,rate);if(rooms.size>=MAX_ROOMS)return json(res,503,{error:'Сервер занят'});let b=await body(req),id;do{id=randomBytes(5).toString('hex')}while(rooms.has(id));let token=makeToken();rooms.set(id,{id,tokens:[token,null],clients:[new Set(),new Set()],game:new Game(b.opts||{}),touched:now});json(res,201,{room:id,token,you:0});return}
let m=u.pathname.match(/^\/api\/rooms\/([a-f0-9]{10})\/(join|state|events|action)$/);if(!m)return json(res,404,{error:'Не найдено'});let r=rooms.get(m[1]);if(!r)return json(res,404,{error:'Комната не найдена. Сервер мог перезапуститься — создайте новую.'});r.touched=Date.now();
if(m[2]==='join'&&req.method==='POST'){if(r.tokens[1])return json(res,409,{error:'Оба места заняты. Для возврата используйте тот же браузер.'});r.tokens[1]=makeToken();json(res,200,{room:r.id,token:r.tokens[1],you:1});send(r);return}
let p=auth(req,r,u);if(m[2]==='state'&&req.method==='GET'){json(res,200,state(r,p));return}
if(m[2]==='events'&&req.method==='GET'){if(r.clients[p].size>=3)return json(res,429,{error:'Слишком много вкладок'});res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});r.clients[p].add(res);send(r);let beat=setInterval(()=>{r.touched=Date.now();res.write(': ping\n\n')},20000);req.on('close',()=>{clearInterval(beat);r.clients[p].delete(res);send(r)});return}
if(m[2]==='action'&&req.method==='POST'){if(!r.tokens[1])return json(res,409,{error:'Подождите подключения друга'});let cmd=await body(req);r.game.action(p,cmd);json(res,200,{ok:true,rev:r.game.rev});send(r);return}json(res,405,{error:'Метод не поддерживается'})
}catch(e){json(res,400,{error:e instanceof SyntaxError?'Некорректный запрос':e.message})}});
setInterval(()=>{let now=Date.now();for(let[id,r]of rooms)if(now-r.touched>TTL&&!r.clients.some(c=>c.size))rooms.delete(id);for(let[ip,ts]of rates)if(!ts.some(t=>now-t<60000))rates.delete(ip)},60000).unref();
server.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('Pirate Island 12x12 ready; health: /health'));
