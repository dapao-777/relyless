/**
 * @file content/paragraph-copy.js
 * 段落干净复制：快捷键（Alt+Shift+C）与右键菜单两个入口。
 * 复制的永远是原文：textMap 只走原始文本节点，提示、词注和译文容器都在排除列表里。
 */
(() => {
  'use strict';
  const kernel = globalThis.ShisuiContent;
  if (!kernel || globalThis.ShisuiCopy) return;
  let lastPointer = null;

  function onPointerTrack(event) { if (event.isTrusted) lastPointer = {clientX: event.clientX, clientY: event.clientY}; }
  function blockAtPointer() {
    if (!lastPointer) return null;
    const element = kernel.pointElement(lastPointer);
    const block = element?.closest?.(kernel.BLOCK_SELECTOR);
    return block && kernel.isVisible(block) && !block.closest(kernel.SKIP) ? block : null;
  }
  function selectedBlock() {
    const selection = kernel.currentSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return null;
    const block = kernel.nodeElement(selection.getRangeAt(0).startContainer)?.closest(kernel.BLOCK_SELECTOR);
    return block && kernel.isVisible(block) && !block.closest(kernel.SKIP) ? block : null;
  }
  async function writeClipboard(text) {
    try { await navigator.clipboard.writeText(text); return; } catch {}
    // 页面可能拦截 Clipboard API，退回 execCommand；隐藏输入框不得抢占当前焦点语义。
    const holder = document.createElement('textarea');
    holder.value = text; holder.setAttribute('readonly', ''); holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;pointer-events:none';
    document.body.append(holder); holder.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch {}
    holder.remove();
    if (!copied) throw new Error('此页面不允许写入剪贴板，请手动选择复制。');
  }
  async function copyParagraph(source = 'pointer') {
    const block = source === 'selection' ? selectedBlock() || blockAtPointer() : blockAtPointer() || selectedBlock();
    if (!block) throw new Error(source === 'selection' ? '没有找到可复制的段落。' : '把鼠标移到要复制的段落上再按快捷键。');
    const text = kernel.normalizeText(kernel.blockText(block));
    if (!text) throw new Error('这个段落没有可复制的文字。');
    await writeClipboard(text);
    kernel.hooks.setPageStatus?.('copy', '已复制本段原文 · ' + text.length + ' 字符', {duration: 2500});
    return kernel.hooks.status?.();
  }
  function onCopyHotkey(event) {
    if (!event.isTrusted || event.repeat || event.altKey !== true || event.shiftKey !== true || event.ctrlKey || event.metaKey || event.code !== 'KeyC' || event.isComposing || kernel.lookupEditing(event)) return;
    kernel.hooks.consumeLookup?.(event); kernel.hooks.clearLookupPreview?.();
    void copyParagraph('pointer').catch(error => kernel.hooks.setPageStatus?.('copy', error.message, {error: true, duration: 3000}));
  }

  globalThis.ShisuiCopy = Object.freeze({onPointerTrack, onCopyHotkey, copyParagraph, blockAtPointer, selectedBlock, writeClipboard});
})();
