import {describe,expect,test} from 'bun:test';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cliSpawnTarget,executableNames} from '../connector/cli-spawn.mjs';
import {buildCodexEnv,CodexClient} from '../connector/codex.mjs';
import {buildGrokEnv} from '../connector/grok.mjs';

describe('cliSpawnTarget',()=>{
  test('passes executables through untouched on every platform',()=>{
    for(const platform of ['linux','darwin','win32']){
      const target=cliSpawnTarget('/opt/tools/codex',['--version'],{platform});
      expect(target).toEqual({command:'/opt/tools/codex',args:['--version'],options:{}});
    }
  });
  test('wraps .cmd and .bat shims through ComSpec on Windows',()=>{
    const target=cliSpawnTarget('C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd',['app-server','--stdio'],{platform:'win32',comspec:'C:\\Windows\\System32\\cmd.exe'});
    expect(target.command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(target.args[0]).toBe('/d');expect(target.args[1]).toBe('/s');expect(target.args[2]).toBe('/c');
    expect(target.args[3]).toContain('codex.cmd');
    expect(target.args[3]).toContain('"app-server" "--stdio"');
    expect(target.options.windowsHide).toBe(true);
  });
  test('does not wrap .cmd off Windows and falls back to cmd.exe without ComSpec',()=>{
    const target=cliSpawnTarget('codex.cmd',['--version'],{platform:'linux'});
    expect(target.command).toBe('codex.cmd');
    const wrapped=cliSpawnTarget('codex.cmd',[],{platform:'win32',comspec:''});
    expect(wrapped.command).toBe('cmd.exe');
  });
  test('quotes arguments containing spaces and quotes',()=>{
    const target=cliSpawnTarget('a b\\tool.cmd',['say "hi"'],{platform:'win32'});
    expect(target.args[3]).toBe('""a b\\tool.cmd" "say ""hi""""');
  });
});

describe('executableNames',()=>{
  test('returns the bare name off Windows',()=>{
    expect(executableNames('codex',{platform:'linux'})).toEqual(['codex']);
  });
  test('expands through PATHEXT order on Windows',()=>{
    expect(executableNames('codex',{platform:'win32',pathext:'.COM;.EXE;.BAT;.CMD'})).toEqual(['codex.com','codex.exe','codex.bat','codex.cmd','codex']);
  });
  test('keeps an explicitly suffixed name as the only candidate',()=>{
    expect(executableNames('grok.cmd',{platform:'win32'})).toEqual(['grok.cmd']);
    expect(executableNames('agy.EXE',{platform:'win32'})).toEqual(['agy.EXE']);
  });
  test('defaults to the common extension list without PATHEXT',()=>{
    expect(executableNames('x',{platform:'win32',pathext:''})).toEqual(['x.com','x.exe','x.bat','x.cmd','x']);
  });
});

describe('connector CLI environments on Windows',()=>{
  const windows={platform:'win32'};
  test('buildCodexEnv uses ; separators, System32, and TEMP/TMP',()=>{
    const env=buildCodexEnv({codexPath:'C:\\npm\\codex.cmd',codexHome:'C:\\data\\codex',tmpDir:'C:\\tmp',
      executablePath:'C:\\Program Files\\nodejs\\node.exe',sourceEnv:{SystemRoot:'C:\\Windows',PATHEXT:'.EXE;.CMD'},...windows});
    expect(env.PATH).toBe('C:\\npm;C:\\Program Files\\nodejs;C:\\Windows\\System32');
    expect(env.TEMP).toBe('C:\\tmp');
    expect(env.TMP).toBe('C:\\tmp');
    expect(env.PATHEXT).toContain('.CMD');
    expect(env.USERPROFILE).toBeTruthy();
    expect(env.CODEX_HOME).toBe('C:\\data\\codex');
  });
  test('buildGrokEnv already supplies the Windows session variables',()=>{
    const env=buildGrokEnv({grokPath:'C:\\npm\\grok.exe',grokHome:'C:\\data\\grok',tmpDir:'C:\\tmp'});
    if(process.platform==='win32'){
      expect(env.TEMP).toBe('C:\\tmp');
      expect(env.COMSPEC).toBeDefined();
      expect(env.PATHEXT).toContain('.CMD');
    }else{
      expect(env.PATH).toContain('/');
    }
  });
});

test('Windows shim spawn propagates process failure and reconnects with a fresh child',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'relyless-win-spawn-'));
  const calls=[];
  const children=[];
  const spawnImpl=(command,args,options)=>{
    calls.push({command,args,options});
    const child=new EventEmitter();
    child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
    child.kill=()=>queueMicrotask(()=>child.emit('exit',0));
    const generation=children.push(child);
    child.stdin.on('data',chunk=>{
      for(const line of chunk.toString().trim().split('\n')){
        const request=JSON.parse(line);
        if(!request.id || (generation===1 && request.method==='model/list')) continue;
        const result=request.method==='account/read'?{account:{type:'chatgpt'}}
          : request.method==='model/list'?{data:[{id:'fixture',displayName:'Fixture',isDefault:true,supportedReasoningEfforts:[]}],nextCursor:null}:{};
        queueMicrotask(()=>child.stdout.write(JSON.stringify({id:request.id,result})+'\n'));
      }
    });
    return child;
  };
  const client=new CodexClient({codexPath:join(directory,'codex.cmd'),dataDir:directory,platform:'win32',spawnImpl,timeoutMs:500});
  try{
    await client.start();
    expect(calls[0].command).toBe(process.env.ComSpec||process.env.COMSPEC||'cmd.exe');
    expect(calls[0].args[3]).toContain('codex.cmd');
    expect(calls[0].options.windowsVerbatimArguments).toBe(true);
    expect(calls[0].options.windowsHide).toBe(true);
    const pending=client.listModels();
    await new Promise(resolve=>setTimeout(resolve,0));
    children[0].emit('error',Object.assign(new Error('shim failed'),{code:'ENOENT'}));
    await expect(pending).rejects.toMatchObject({code:'DISCONNECTED'});
    await client.start();
    expect(calls).toHaveLength(2);
    expect(await client.listModels()).toEqual([{id:'fixture',name:'Fixture',isDefault:true,supportedReasoningEfforts:undefined}]);
  }finally{await client.close();await rm(directory,{recursive:true,force:true});}
});