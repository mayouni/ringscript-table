/*
** Does the index actually pay for itself? The library's whole reason for
** existing is that reading through a sorted view is random access, and a
** Ring list walks for those. Same operations, same data, index on and off.
*/
const fs=require("fs"),path=require("path");
const HOME=process.env.RINGSCRIPT_HOME||path.join(__dirname,"..","..","ringscript");
const RT=path.join(HOME,"playground");
const RS=require(path.join(RT,"ringscript.js"));
const N=parseInt(process.argv[2],10)||20000;

function rng(s){let a=s>>>0;return()=>{a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);
  t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}

(async()=>{
  const b=fs.readFileSync(path.join(RT,"ringscript.wasm"));
  const bytes=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
  const src=fs.readFileSync(path.join(__dirname,"..","ring","table.ring"),"utf8");
  const r=rng(7),rows=[];
  for(let i=1;i<=N;i++) rows.push([i,"m"+String(1+Math.floor(r()*20)).padStart(2,"0"),
      Math.floor(r()*900)+50, r()<0.9?"ACTIVE":"CLOSED"]);
  const payload=JSON.stringify([["columns",["id","member","amount","status"]],["rows",rows]]);

  async function run(indexed){
    const vm=await RS.load(bytes,{onOutput:()=>{}});
    vm.eval(src);
    const P=(f,a)=>{const x=vm.call(f,a===undefined?1:a);if(!x.ok)throw new Error(f+": "+x.error);
      const v=x.result; if(typeof v!=="string")return v; const t=v.trim();
      return (t[0]==="{"||t[0]==="[")?JSON.parse(t):v;};
    if(!indexed) P("TableIndexFloor", N*10);       // never worth it -> never built
    P("TableLoad",payload);
    let t=Date.now(); P("TableSort",JSON.stringify([["column","amount"],["desc",1]]));
    const sort=Date.now()-t;
    t=Date.now(); const agg=P("TableAggregate",JSON.stringify([["column","amount"]]));
    const aggregate=Date.now()-t;
    t=Date.now(); const grp=P("TableGroup",JSON.stringify([["by","member"],["value","amount"],["top",5]]));
    const group=Date.now()-t;
    t=Date.now(); for(let p=1;p<=2000;p+=25) P("TablePage",JSON.stringify([["from",p],["count",25]]));
    const paging=Date.now()-t;
    return {sort,aggregate,group,paging,checksum:agg.sum,top:grp[0].group};
  }

  const off=await run(false), on=await run(true);
  console.log("  "+N.toLocaleString()+" rows, sorted by amount then read through\n");
  console.log("  operation      no index     indexed     ");
  for(const k of ["sort","aggregate","group","paging"]){
    const ratio=off[k]/Math.max(on[k],1);
    console.log("  "+k.padEnd(13)+String(off[k]+" ms").padStart(9)+
                String(on[k]+" ms").padStart(12)+"   "+(ratio>=2?ratio.toFixed(0)+"x":""));
  }
  console.log("\n  checksums "+(off.checksum===on.checksum&&off.top===on.top?"agree":"DISAGREE"));
})().catch(e=>{console.error("ERROR",e.message);process.exit(1);});
