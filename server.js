import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {create,view,action} from './game.js';
const rooms=new Map(),limits=new Map(),TTL=24*60*60*1000,MAX=300;
const token=()=>randomBytes(24).toString('hex');
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
function snapshot(r,p){return {room:r.id,you:p,ready:!!r.tokens[1],online:[r.clients[0].size>0,r.clients[1].size>0],game:view(r.game)}}
function send(r){for(let p=0;p<2;p++)for(let c of r.clients[p]){if(!c.destroyed)c.write('data: '+JSON.stringify(snapshot(r,p))+'\n\n')}}
async function body(req){let b='';for await(let c of req){b+=c;if(b.length>12000)throw Error('Слишком большой запрос')}return b?JSON.parse(b):{}}
function auth(req,r,url){let t=req.headers.authorization?.replace(/^Bearer /,'')||url.searchParams.get('token'),p=r.tokens.indexOf(t);if(!t||p<0)throw Error('Нужен ключ игрока. Откройте сохранённую комнату в том же браузере.');return p}
const server=http.createServer(async(req,res)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');let u=new URL(req.url,'http://localhost');try{
if(req.method==='GET'&&u.pathname==='/health'){res.end('ok');return}
if(req.method==='GET'&&u.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(await readFile(new URL('./public/index.html',import.meta.url)));return}
if(req.method==='POST'&&u.pathname==='/api/rooms'){let ip=req.socket.remoteAddress,now=Date.now(),rate=limits.get(ip)||[];rate=rate.filter(t=>now-t<60000);if(rate.length>=10)return json(res,429,{error:'Слишком много комнат. Подождите минуту.'});rate.push(now);limits.set(ip,rate);if(rooms.size>=MAX)return json(res,503,{error:'Сервер занят'});let b=await body(req),id;do{id=randomBytes(5).toString('hex')}while(rooms.has(id));let t=token(),r={id,tokens:[t,null],clients:[new Set(),new Set()],game:create(b.opts||{}),touched:now};rooms.set(id,r);json(res,201,{room:id,token:t,you:0});return}
let m=u.pathname.match(/^\/api\/rooms\/([a-f0-9]{10})\/(join|state|events|action)$/);if(!m)return json(res,404,{error:'Не найдено'});let r=rooms.get(m[1]);if(!r)return json(res,404,{error:'Комната не найдена: сервер мог перезапуститься. Создайте новую.'});r.touched=Date.now();if(m[2]==='join'&&req.method==='POST'){if(r.tokens[1])return json(res,409,{error:'В комнате уже два игрока. Для возврата используйте тот же браузер.'});r.tokens[1]=token();json(res,200,{room:r.id,token:r.tokens[1],you:1});send(r);return}
let p=auth(req,r,u);
if(m[2]==='state'&&req.method==='GET'){json(res,200,snapshot(r,p));return}
if(m[2]==='events'&&req.method==='GET'){if(r.clients[p].size>=3){res.writeHead(429);res.end();return}res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});r.clients[p].add(res);send(r);let heartbeat=setInterval(()=>{r.touched=Date.now();res.write(': ping\n\n')},20000);req.on('close',()=>{clearInterval(heartbeat);r.clients[p].delete(res);send(r)});return}
if(m[2]==='action'&&req.method==='POST'){if(!r.tokens[1])return json(res,409,{error:'Подождите друга'});let cmd=await body(req);action(r.game,p,cmd);json(res,200,{ok:true,rev:r.game.rev});send(r);return}
json(res,405,{error:'Метод не поддерживается'})
}catch(e){json(res,400,{error:e instanceof SyntaxError?'Некорректный запрос':e.message})}});
setInterval(()=>{for(let [id,r]of rooms)if(Date.now()-r.touched>TTL&&!r.clients.some(c=>c.size))rooms.delete(id);for(let [ip,ts]of limits)if(!ts.some(t=>Date.now()-t<60000))limits.delete(ip)},60000).unref();
server.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('Pirate island ready'));
