// Observe the existing response bytes without another request or another agent loop.
import { AsyncLocalStorage } from 'node:async_hooks';
const context = new AsyncLocalStorage();
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async function (...args) {
  const sink = context.getStore();
  const response = await fetchOriginal.apply(this, args);
  if (!sink || !response.ok || !response.body || !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) return response;
  const observer = new ToolStreamObserver(sink);
  const body = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) { controller.enqueue(chunk); try { observer.push(chunk); } catch { /* Rendering must never alter the model transport. */ } },
    flush() { try { observer.finish(); } catch {} },
  }));
  const copy = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  for (const property of ['url', 'redirected', 'type']) Object.defineProperty(copy, property, { value: response[property] });
  return copy;
};
export function observeToolStream(sink, operation) { return context.run(sink, operation); }

export class ToolStreamObserver {
  constructor(sink) { this.sink = sink; this.decoder = new TextDecoder(); this.buffer = ''; this.calls = new Map(); this.aliases = new Map(); }
  call(key) { if (!this.calls.has(key)) this.calls.set(key, { id: String(key), name: '', arguments: '' }); return this.calls.get(key); }
  notify(call, complete = false) {
    if (call.arguments.length <= 4 * 1024 * 1024 && ['Write', 'Edit', 'MultiEdit'].includes(call.name)) this.sink({ ...call, complete });
  }
  push(bytes) {
    this.buffer += this.decoder.decode(bytes, { stream: true });
    if (this.buffer.length > 8 * 1024 * 1024) { this.buffer = ''; return; }
    let boundary;
    while ((boundary = /\r?\n\r?\n/.exec(this.buffer))) {
      const block = this.buffer.slice(0, boundary.index); this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
      const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!data || data === '[DONE]') continue;
      let raw; try { raw = JSON.parse(data); } catch { continue; }
      this.event(raw);
    }
  }
  finish() { this.push(new TextEncoder().encode('\n\n')); }
  event(raw) {
    if (raw.type === 'response.output_item.added' && raw.item?.type === 'function_call') {
      const key = raw.item.call_id || raw.item.id;
      const call = this.call(key); call.id = key; call.name = raw.item.name;
      if (raw.item.id) this.aliases.set(raw.item.id, key);
      if (raw.output_index !== undefined) this.aliases.set(`index:${raw.output_index}`, key);
      this.notify(call);
    } else if (raw.type === 'response.function_call_arguments.delta') {
      const key = this.aliases.get(raw.item_id) ?? this.aliases.get(`index:${raw.output_index}`) ?? raw.call_id ?? raw.item_id;
      const call = this.call(key); call.arguments += raw.delta || ''; this.notify(call);
    } else if (raw.type === 'response.output_item.done' && raw.item?.type === 'function_call') {
      const call = this.call(raw.item.call_id || raw.item.id); call.name = raw.item.name; call.arguments = raw.item.arguments || '{}'; this.notify(call, true);
    }
    for (const choice of raw.choices ?? []) {
      for (const part of choice.delta?.tool_calls ?? []) {
        const call = this.call(`openai:${choice.index ?? 0}:${part.index ?? 0}`);
        if (part.id) call.id = part.id;
        if (part.function?.name) call.name += part.function.name;
        call.arguments += part.function?.arguments || ''; this.notify(call);
      }
      if (choice.finish_reason === 'tool_calls') for (const call of this.calls.values()) this.notify(call, true);
    }
    if (raw.type === 'content_block_start' && raw.content_block?.type === 'tool_use') {
      const call = this.call(`anthropic:${raw.index}`); call.id = raw.content_block.id; call.name = raw.content_block.name;
      call.arguments = Object.keys(raw.content_block.input ?? {}).length ? JSON.stringify(raw.content_block.input) : ''; this.notify(call);
    } else if (raw.type === 'content_block_delta' && raw.delta?.type === 'input_json_delta') {
      const call = this.call(`anthropic:${raw.index}`); call.arguments += raw.delta.partial_json || ''; this.notify(call);
    } else if (raw.type === 'content_block_stop') this.notify(this.call(`anthropic:${raw.index}`), true);
  }
}

// Decode only a JSON string prefix; never eval incomplete model output.
export function partialString(json, property) {
  const expression = new RegExp(`(?:^|[,{])\\s*"${property}"\\s*:\\s*"`, 'g');
  const match = expression.exec(json); if (!match) return null;
  let text = '';
  for (let i = expression.lastIndex; i < json.length; i++) {
    const char = json[i];
    if (char === '"') return { text, complete: true };
    if (char !== '\\') { text += char; continue; }
    const next = json[++i]; if (next === undefined) break;
    if (next === 'u') {
      const hex = json.slice(i + 1, i + 5); if (!/^[0-9a-f]{4}$/i.test(hex)) break;
      text += String.fromCharCode(Number.parseInt(hex, 16)); i += 4;
    } else {
      const escapes = { '"': '"', '\\': '\\', '/': '/', n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
      if (!(next in escapes)) break;
      text += escapes[next];
    }
  }
  if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  return { text, complete: false };
}
