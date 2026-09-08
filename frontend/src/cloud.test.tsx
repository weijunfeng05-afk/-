import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';

afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllEnvs();vi.unstubAllGlobals();vi.resetModules();});

it('gates cloud data until an access key is validated and clears it on logout',async()=>{
  vi.stubEnv('VITE_API_BASE_URL','https://backend.example');
  const fetch=vi.fn(async()=>({ok:true,json:async()=>[]}));vi.stubGlobal('fetch',fetch);
  const {default:CloudAccess}=await import('./CloudAccess');
  render(<CloudAccess><p>Private results</p></CloudAccess>);
  expect(screen.queryByText('Private results')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('工作空间访问密钥'),{target:{value:'workspace-key'}});
  fireEvent.click(screen.getByRole('button',{name:'进入工作空间'}));
  await screen.findByText('Private results');
  expect(fetch).toHaveBeenCalledWith('https://backend.example/api/jobs',expect.objectContaining({headers:{Authorization:'Bearer workspace-key'}}));
  fireEvent.click(screen.getByText('退出工作空间'));
  expect(sessionStorage.getItem('resume-access-token')).toBeNull();
  expect(screen.queryByText('Private results')).not.toBeInTheDocument();
});

it('rejects wrong cloud key without exposing workspace content',async()=>{
  vi.stubEnv('VITE_API_BASE_URL','https://backend.example');
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,json:async()=>({message:'密钥无效'})})));
  const {default:CloudAccess}=await import('./CloudAccess');
  render(<CloudAccess><p>Private results</p></CloudAccess>);
  fireEvent.change(screen.getByLabelText('工作空间访问密钥'),{target:{value:'bad-key'}});
  fireEvent.click(screen.getByRole('button',{name:'进入工作空间'}));
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('密钥无效'));
  expect(sessionStorage.getItem('resume-access-token')).toBeNull();
  expect(screen.queryByText('Private results')).not.toBeInTheDocument();
});
