import {expect,test} from 'bun:test';
import {createSpeechHandler} from '../extension/speech.js';

const voice={voiceName:'Local English',lang:'en-US',remote:false,eventTypes:['start','end']};
function port(){
  let receive,disconnect;
  const events=[];
  return {events,onMessage:{addListener(fn){receive=fn;}},onDisconnect:{addListener(fn){disconnect=fn;}},postMessage(event){events.push(event);},speak(text){return receive({text});},close(){disconnect();}};
}

test('closing while voices load cannot start late speech',async()=>{
  let release;const calls=[];
  const connect=createSpeechHandler({getVoices:()=>new Promise(resolve=>{release=resolve;}),speak:text=>calls.push(text),stop(){}});
  const client=port();connect(client);
  const pending=client.speak('cache');client.close();release([voice]);await pending;
  expect(calls).toEqual([]);
  expect(client.events).toEqual([]);
});

test('replacement owns playback even when the old voice lookup finishes last',async()=>{
  let release;const utterances=[];let lookups=0,stops=0;
  const connect=createSpeechHandler({getVoices:()=>++lookups===1?new Promise(resolve=>{release=resolve;}):Promise.resolve([voice]),speak:(text,options)=>{utterances.push({text,options});},stop(){stops++;}});
  const word=port(),sentence=port();connect(word);connect(sentence);
  const old=word.speak('cache');await sentence.speak('The cache stores recent data.');
  release([voice]);await old;
  expect(utterances.map(item=>item.text)).toEqual(['The cache stores recent data.']);
  expect(word.events.map(event=>event.type)).toEqual(['interrupted']);
  word.close();const before=stops;
  utterances[0].options.onEvent({type:'start'});sentence.close();
  expect(stops).toBe(before+1);
  utterances[0].options.onEvent({type:'end'});
  expect(sentence.events.map(event=>event.type)).toEqual(['start']);
});

test('late events from interrupted speech cannot finish the replacement',async()=>{
  const utterances=[];
  const connect=createSpeechHandler({getVoices:async()=>[voice],speak:(text,options)=>{utterances.push({text,options});},stop(){}});
  const first=port(),second=port();connect(first);connect(second);
  await first.speak('cache');await second.speak('The cache stores recent data.');
  utterances[0].options.onEvent({type:'end'});utterances[0].options.onEvent({type:'error',errorMessage:'late failure'});
  expect(second.events).toEqual([]);
  utterances[1].options.onEvent({type:'start'});utterances[1].options.onEvent({type:'end'});
  expect(second.events.map(event=>event.type)).toEqual(['start','end']);
  expect(first.events.map(event=>event.type)).toEqual(['interrupted']);
});

test('remote voices cannot silently replace unavailable local speech',async()=>{
  const spoken=[];
  const connect=createSpeechHandler({getVoices:async()=>[{...voice,remote:true,extensionId:'remote-engine'}],speak:text=>spoken.push(text),stop(){}});
  const client=port();connect(client);await client.speak('cache');
  expect(client.events.map(event=>event.type)).toEqual(['error']);
  expect(spoken).toEqual([]);
});
