export function startTaskPolling(refresh:()=>Promise<unknown>,running:boolean,visibility:Pick<Document,'hidden'|'addEventListener'|'removeEventListener'>,schedule:typeof setTimeout=setTimeout,cancel:typeof clearTimeout=clearTimeout){
 let timer:ReturnType<typeof setTimeout>|undefined,closed=false,inFlight=false;
 const tick=async()=>{
  if(closed||visibility.hidden||inFlight)return;inFlight=true;
  try{await refresh()}catch{}finally{inFlight=false;if(!closed&&running&&!visibility.hidden)timer=schedule(tick,3000)}
 };
 const visible=()=>{cancel(timer);if(!visibility.hidden)void tick()};
 if(running&&!visibility.hidden)timer=schedule(tick,3000);
 visibility.addEventListener('visibilitychange',visible);
 return()=>{closed=true;cancel(timer);visibility.removeEventListener('visibilitychange',visible)};
}
