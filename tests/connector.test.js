import assert from "node:assert/strict";
import test from "node:test";
import { encodeNativeMessage, NativeMessageDecoder, validateExtensionOrigin } from "../connector/host.mjs";

test("native framing accepts fragmented and coalesced messages", () => {
  const received = [];
  const errors = [];
  const decoder = new NativeMessageDecoder({ onMessage: (value) => received.push(value), onError: (error) => errors.push(error) });
  const first = encodeNativeMessage({ id: 1, type: "status" });
  const second = encodeNativeMessage({ id: 2, type: "cancel", payload: {} });
  const thirdMessage = { id: 3, type: "emergencyTranslate", payload: { scope: "passage", items: [{ id: "block", text: "Keep the English." }], model: "quick" } };
  const third = encodeNativeMessage(thirdMessage);

  decoder.push(first.subarray(0, 2));
  decoder.push(Buffer.concat([first.subarray(2), second, third]));
  decoder.end();

  assert.deepEqual(received, [{ id: 1, type: "status" }, { id: 2, type: "cancel", payload: {} }, thirdMessage]);
  assert.equal(errors.length, 0);
});

test("native framing fails closed on oversized, malformed, and truncated input", () => {
  for (const chunks of [
    [Buffer.from([0xff, 0xff, 0xff, 0x7f])],
    [Buffer.concat([Buffer.from([1, 0, 0, 0]), Buffer.from("{")])],
    [encodeNativeMessage({ id: 1 }).subarray(0, 5)],
  ]) {
    let failed = false;
    const decoder = new NativeMessageDecoder({ maxBytes: 128, onMessage: () => assert.fail("不应接受无效消息"), onError: () => { failed = true; } });
    for (const chunk of chunks) decoder.push(chunk);
    decoder.end();
    assert.equal(failed, true);
  }
});

test("native origin validation requires the exact canonical extension origin", () => {
  const origin = `chrome-extension://${"a".repeat(32)}/`;
  assert.equal(validateExtensionOrigin(origin, origin), true);
  assert.equal(validateExtensionOrigin(origin, `chrome-extension://${"b".repeat(32)}/`), false);
  assert.equal(validateExtensionOrigin(origin, `${origin}?x=1`), false);
  assert.equal(validateExtensionOrigin(origin, `https://${"a".repeat(32)}/`), false);
});
