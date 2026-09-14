import postgres from 'postgres';
let pool: ReturnType<typeof postgres> | undefined;
function connection() {
  if(!process.env.DATABASE_URL) throw Error('DATABASE_URL is required');
  return pool ??= postgres(process.env.DATABASE_URL, {max:1,prepare:false,ssl:'require',idle_timeout:20,connect_timeout:10,
    types:{bigint:{to:20,from:[20],serialize:String,parse:Number}}});
}
// Only application-authored SQL is accepted. Values remain bound parameters.
export function placeholders(sql:string) {
  let n=0; return sql.replace(/'(?:''|[^'])*'|\?/g, token=>token==='?'?'$'+(++n):token);
}
export function postgresDatabase(owner:string) {
  async function execute(statements: Statement[]) {
    return connection().begin(async tx=>{
      // Transaction-local identity prevents pooled connections leaking user context.
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({sub:owner,role:'authenticated'})}, true)`;
      await tx`set local role app_backend`;
      await tx`set local search_path = public`;
      const out=[];
      for(const statement of statements){
        const rows=await tx.unsafe(placeholders(statement.sql),statement.args as never[]);
        out.push({results:Array.from(rows),meta:{changes:rows.count}});
      }
      return out;
    });
  }
  class Statement {
    constructor(public sql:string,public args:unknown[]=[]){}
    bind(...args:unknown[]){return new Statement(this.sql,args);}
    async first<T=Record<string,unknown>>(){const result=await execute([this]);return (result[0].results[0]||null) as T|null;}
    async all(){return (await execute([this]))[0];}
    async run(){return (await execute([this]))[0];}
  }
  return {prepare:(sql:string)=>new Statement(sql),batch:execute};
}
