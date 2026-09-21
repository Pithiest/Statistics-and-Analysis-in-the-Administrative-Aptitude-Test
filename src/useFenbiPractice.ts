import {useCallback,useEffect,useRef,useState} from "react";
import {FENBI_SESSION_KEY,getFenbiAccount,getFenbiPractices,readFenbiSession,reviewFenbiPractice,storeFenbiSession,syncFenbiNow,MistakeApiError,mistakeErrorMessage} from "./mistakeApi";
import type {FenbiAccount} from "./mistakeApi";
import type {FenbiPractice} from "./fenbiPractice";

export function useFenbiPractice() {
 const [session,setSession]=useState(readFenbiSession);
 const [snapshot,setSnapshot]=useState<{owner:string;items:FenbiPractice[]}>({owner:"",items:[]});
 const [account,setAccount]=useState<FenbiAccount|null>(null);
 const [error,setError]=useState("");
 const [loading,setLoading]=useState(false);
 const [revision,setRevision]=useState(0);
 const refresh=useCallback(()=>setRevision(n=>n+1),[]);
 const mountedToken=useRef(session?.token);mountedToken.current=session?.token;
 useEffect(()=>{
  const changed=()=>setSession(readFenbiSession());
  const storage=(e:StorageEvent)=>{if(!e.key||e.key===FENBI_SESSION_KEY)changed();};
  window.addEventListener("fenbi-session-change",changed);window.addEventListener("storage",storage);
  return()=>{window.removeEventListener("fenbi-session-change",changed);window.removeEventListener("storage",storage);};
 },[]);
 useEffect(()=>{
  setAccount(null);setError("");
  if(!session){setSnapshot({owner:"",items:[]});return;}
  const controller=new AbortController(),token=session.token,owner=session.accountId,cacheKey=`xc-fenbi-practice-v1:${owner}`;
  let alive=true,busy=false,lastCheck=0,stamp:string|null|undefined;
  try{const cached=JSON.parse(localStorage.getItem(cacheKey)||"null");if(cached?.owner===owner&&Array.isArray(cached.items)){setSnapshot(cached);stamp=cached.stamp;}}catch{ /* Read-only cache can be recovered from the server. */ }
  const pull=async(force=false)=>{
   if(!alive||busy||!navigator.onLine||(!force&&Date.now()-lastCheck<120000))return;
   lastCheck=Date.now();busy=true;setLoading(true);
   try{
    const status=await getFenbiAccount(token,controller.signal);if(!alive)return;
    if(status.accountId!==owner)throw new MistakeApiError("账号状态变化，请重新登录。",401);
    setAccount(status);setError("");
    if(stamp!==status.historyUpdatedAt||stamp===undefined){
     const items:FenbiPractice[]=[];let offset:number|null=0,pages=0;
     while(offset!==null){if(pages++>1000)throw new Error("pagination exceeded");const page=await getFenbiPractices(token,offset,controller.signal);if(!alive)return;if(page.account.accountId!==owner)throw new Error("owner mismatch");items.push(...page.items);offset=page.next;}
     const dedup=[...new Map(items.map(item=>[item.key,item])).values()].sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt));
     stamp=status.historyUpdatedAt;setSnapshot({owner,items:dedup});
     try{localStorage.setItem(cacheKey,JSON.stringify({owner,items:dedup,stamp}));}catch{setError("当前设备暂时不能缓存完整练习；云端记录已保存，联网时可继续使用。");}
    }
    // Opening the site refreshes stale provider data automatically; the server also runs every six hours.
    if(["idle","error"].includes(status.syncState)&&(!status.lastAttempt||Date.now()-Date.parse(status.lastAttempt)>15*60000))await syncFenbiNow(token,controller.signal);
   }catch(failure){if(!alive)return;if(failure instanceof MistakeApiError&&failure.status===401){if(readFenbiSession()?.token===token)storeFenbiSession(null);}else setError(mistakeErrorMessage(failure));}
   finally{busy=false;if(alive)setLoading(false);}
  };
  void pull(true);const interval=setInterval(()=>{if(!document.hidden)void pull();},15000);
  const online=()=>void pull(true),focus=()=>void pull();
  window.addEventListener("online",online);window.addEventListener("focus",focus);
  return()=>{alive=false;controller.abort();clearInterval(interval);window.removeEventListener("online",online);window.removeEventListener("focus",focus);};
 },[session?.token,session?.accountId,revision]);
 const markReviewed=async(key:string)=>{
  if(!session)return;
  try{const result=await reviewFenbiPractice(session.token,key);if(mountedToken.current!==session.token)return;setSnapshot(old=>old.owner===session.accountId?{...old,items:old.items.map(p=>p.key===key?{...p,reviewedAt:result.reviewedAt}:p)}:old);refresh();}
  catch(failure){if(mountedToken.current===session.token)setError(mistakeErrorMessage(failure));}
 };
 return {session,items:snapshot.owner===session?.accountId?snapshot.items:[],account:account?.accountId===session?.accountId?account:null,error,loading,refresh,markReviewed};
}
