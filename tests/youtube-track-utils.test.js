import {expect,test} from 'bun:test';
import '../extension/youtube-captions-bridge.js';

const utils = globalThis.ShisuiYoutubeTrackUtils;

test('youtube video ids come from watch, shorts, embed and live paths', () => {
  expect(utils.youtubeVideoId('/watch', '?v=abc123XYZ')).toBe('abc123XYZ');
  expect(utils.youtubeVideoId('/shorts/abcdef', '')).toBe('abcdef');
  expect(utils.youtubeVideoId('/embed/xyz12345', '')).toBe('xyz12345');
  expect(utils.youtubeVideoId('/live/abc12345', '')).toBe('abc12345');
  expect(utils.youtubeVideoId('/watch', '?list=PL123')).toBe('');
  expect(utils.youtubeVideoId('/live/videoseries', '?list=PL123')).toBe('');
  expect(utils.youtubeVideoId('/watch', '')).toBe('');
});

test('timedtext urls are accepted only from youtube over https', () => {
  expect(utils.timedtextUrl('https://www.youtube.com/api/timedtext?v=a&lang=en')).toBe('https://www.youtube.com/api/timedtext?v=a&lang=en');
  expect(utils.timedtextUrl('/api/timedtext?v=b', 'https://www.youtube.com/watch?v=b')).toBe('https://www.youtube.com/api/timedtext?v=b');
  expect(utils.timedtextUrl('http://www.youtube.com/api/timedtext')).toBe('');
  expect(utils.timedtextUrl('https://evil.example.com/api/timedtext')).toBe('');
  expect(utils.timedtextUrl('https://www.youtube.com/api/other')).toBe('');
  expect(utils.timedtextUrl('::::not a url::::')).toBe('');
});

test('english tracks prefer manual captions and fall back to asr', () => {
  const tracks = [{languageCode: 'es'}, {languageCode: 'en', kind: 'asr'}, {languageCode: 'en'}];
  expect(utils.chooseEnglishTrack(tracks, null)).toEqual({languageCode: 'en'});
  expect(utils.chooseEnglishTrack([{languageCode: 'en', kind: 'asr'}], null)).toEqual({languageCode: 'en', kind: 'asr'});
  expect(utils.chooseEnglishTrack(tracks, {languageCode: 'en', kind: 'asr'})).toEqual({languageCode: 'en', kind: 'asr'});
  expect(utils.chooseEnglishTrack([{languageCode: 'fr'}], {languageCode: 'fr'})).toBeNull();
  expect(utils.isEnglishLanguageCode('en-US')).toBe(true);
  expect(utils.isEnglishLanguageCode('es')).toBe(false);
  expect(utils.isEnglishLanguageCode(null)).toBe(false);
});
