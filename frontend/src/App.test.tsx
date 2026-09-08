import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import App from './App';
import {sortResumes} from './types';
import type {Resume} from './types';

let requests:{path:string;body:Record<string,unknown>|null}[]=[];
const profiles=[{id:'generic',name:'通用岗位匹配',criteria:[]},{id:'toc',name:'ToC 商业化产品运营',criteria:[{id:'growth_results',label:'用户增长、留存、转化及商业化结果',weight:30}]},{id:'internal_ai',name:'内部提效 AI 产品经理',criteria:[{id:'ai_practice',label:'AI/大模型产品理解与真实实践',weight:30}]}];
const config={base_url:'',model:'',key_set:false,key_mask:'',config_version:0,encryption_ready:true};
beforeEach(()=>{localStorage.clear();requests=[];vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{const body=init?.body?JSON.parse(init.body as string):null;requests.push({path,body});if(path==='/api/scoring-profiles')return {ok:true,json:async()=>profiles};if(path==='/api/jobs'&&init?.method==='POST')return {ok:true,json:async()=>({id:'j1',...body,version:1,created_at:1})};if(path==='/api/jobs')return {ok:true,json:async()=>[]};if(path==='/api/model-config')return {ok:true,json:async()=>config};return {ok:true,json:async()=>[]};}));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

describe('app journeys',()=>{
  it('shows an honest empty state and permits manual confirmed requirements',async()=>{
    render(<App/>);await screen.findByText('从第一个岗位开始');
    fireEvent.click(screen.getByText('创建第一个岗位'));
    fireEvent.change(screen.getByRole('combobox',{name:'评分标准'}),{target:{value:'generic'}});
    fireEvent.change(screen.getByPlaceholderText('例如：Python 后端工程师'),{target:{value:'后端工程师'}});
    fireEvent.change(screen.getByPlaceholderText('每行一项，例如：熟练使用 Python'),{target:{value:'Python\n\nSQL\n'}});
    fireEvent.click(screen.getByText('添加条件'));
    fireEvent.change(screen.getByLabelText('条件 1 内容'),{target:{value:'掌握 Python'}});
    fireEvent.click(screen.getByText('确认并保存'));
    await waitFor(()=>expect(requests.some(r=>r.path==='/api/jobs'&&r.body?.confirmed===true)).toBe(true));
    const body=requests.find(r=>r.body?.confirmed===true)!.body!;
    expect(body.requirements).toMatchObject({skills:['Python','SQL'],conditions:[{text:'掌握 Python',kind:'must'}]});
  });
  it('keeps the API key masked and sends configuration only on save',async()=>{
    render(<App/>);await screen.findByText('从第一个岗位开始');
    fireEvent.click(screen.getByRole('button',{name:'模型配置'}));
    const key=screen.getByPlaceholderText('填写你的 API Key');
    expect(key).toHaveAttribute('type','password');
    fireEvent.change(screen.getByPlaceholderText('https://api.example.com/v1'),{target:{value:'https://provider.example/v1'}});
    fireEvent.change(key,{target:{value:'local-secret'}});
    fireEvent.change(screen.getByPlaceholderText('填写服务商提供的模型 ID'),{target:{value:'test-model'}});
    expect(requests.every(r=>!r.body)).toBe(true);
    fireEvent.click(screen.getByText('保存配置'));
    await waitFor(()=>expect(requests.some(r=>r.body?.api_key==='local-secret')).toBe(true));
    await waitFor(()=>expect(key).toHaveValue(''));
    expect(screen.queryByText('local-secret')).not.toBeInTheDocument();
  });
  it('shows a useful error instead of dropping a failed save',async()=>{
    render(<App/>);await screen.findByText('从第一个岗位开始');
    fireEvent.click(screen.getByText('创建第一个岗位'));
    fireEvent.change(screen.getByPlaceholderText('例如：Python 后端工程师'),{target:{value:'test'}});
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,json:async()=>({message:'请完善岗位要求'})})));
    fireEvent.click(screen.getByText('确认并保存'));
    expect(await screen.findByRole('alert')).toHaveTextContent('请完善岗位要求');
    expect(screen.getByPlaceholderText('例如：Python 后端工程师')).toHaveValue('test');
  });
});

it('excludes provisional, stale and failed historical results from the normal ranking',()=>{
  const row=(id:string,score:number,extra:object={},status='succeeded')=>({id,created_at:1,match:{total_score:score,category:'优先查看',stale:false,provisional:false,...extra},task:{status}} as Resume);
  const rows=[row('unknown',99,{provisional:true}),row('stale',98,{stale:true}),row('failed',97,{},'failed'),row('ok',80)];
  expect(sortResumes(rows,'全部','score_desc')[0].id).toBe('ok');
  expect(sortResumes(rows,'分析失败','score_desc').map(r=>r.id)).toEqual(['failed']);
});

it('lets a role use the legacy AI rubric and persists the choice',async()=>{
  render(<App/>);await screen.findByText('从第一个岗位开始');
  fireEvent.click(screen.getByText('创建第一个岗位'));
  const select=screen.getByRole('combobox',{name:'评分标准'});
  expect(select).toHaveValue('toc');
  fireEvent.change(select,{target:{value:'internal_ai'}});
  const dimension=screen.getByRole('textbox',{name:/AI\/大模型产品理解与真实实践/});
  fireEvent.change(dimension,{target:{value:' 搭建 AI 原型\n\n '}});
  fireEvent.change(screen.getByPlaceholderText('例如：Python 后端工程师'),{target:{value:'AI 产品经理'}});
  fireEvent.click(screen.getByText('确认并保存'));
  await waitFor(()=>expect(requests.some(r=>(r.body?.requirements as {scoring_profile?:string})?.scoring_profile==='internal_ai')).toBe(true));
  expect(requests.find(r=>r.body?.confirmed===true)?.body?.requirements).toMatchObject({rubric_requirements:{ai_practice:['搭建 AI 原型']}});
});

it('cancels job deletion, then deletes the last role and clears selection',async()=>{
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  let deleted=false;
  const deletion=vi.fn();
  const job={id:'j-delete',name:'过期岗位',created_at:1,version:1,jd_text:'JD',confirmed:true,requirements:{skills:['Python'],experience:[],other:[],conditions:[]}};
  vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
    if(init?.method==='DELETE'){deletion();deleted=true;return {ok:true,json:async()=>({deleted:true})};}
    return {ok:true,json:async()=>path==='/api/jobs'?(deleted?[]:[job]):path==='/api/scoring-profiles'?profiles:config};
  }));
  render(<App/>);await screen.findByText('过期岗位');
  fireEvent.click(screen.getByRole('button',{name:'删除岗位 过期岗位'}));
  expect(screen.getByRole('dialog')).toHaveTextContent('简历原文件和其他岗位的数据会保留');
  fireEvent.click(screen.getByRole('button',{name:'取消'}));
  expect(deletion).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'删除岗位 过期岗位'}));
  fireEvent.click(screen.getByRole('button',{name:'确认删除岗位'}));
  await screen.findByText('从第一个岗位开始');
  expect(deletion).toHaveBeenCalledOnce();
  expect(localStorage.getItem('resume-job')).toBe('');
});

it('retains the job and shows an error when deletion fails',async()=>{
  const job={id:'j1',name:'保留岗位',created_at:1,version:1,requirements:{skills:[],experience:[],other:[],conditions:[]}};
  vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>init?.method==='DELETE'?{ok:false,json:async()=>({message:'暂时无法删除'})}:{ok:true,json:async()=>path==='/api/jobs'?[job]:path==='/api/scoring-profiles'?profiles:config}));
  render(<App/>);await screen.findByText('保留岗位');
  fireEvent.click(screen.getByRole('button',{name:'删除岗位 保留岗位'}));
  fireEvent.click(screen.getByRole('button',{name:'确认删除岗位'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法删除');
  expect(screen.getByText('保留岗位')).toBeInTheDocument();
});
