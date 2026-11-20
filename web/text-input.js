// SPDX-License-Identifier: MPL-2.0
// Shared checked module: only explicit browser entry, never document-wide keys.
(() => {
  const integer = n => Number.isSafeInteger(n) && n >= 0 && n <= 0x7fffffff;
  const reasons = ['Delivered to the game.', 'Input cancelled: focus changed.', 'Unsupported input or guest text. Use printable ASCII, fewer than 256 characters.', 'The game rejected the edit.', 'The game changed focus or text; edit cancelled.', 'Nested editing is unsupported.', 'Input queue full; character not entered.'];
  function worker(post) {
    let runtime, epoch = 0, active = false, closed = false;
    const result = (sequence, status) => { if (!closed && integer(sequence) && integer(status) && status < reasons.length) post({type:'text-result', sequence, status}); };
    return {
      bind(value) { runtime = value; },
      focus(value, enabled) { if (closed) return; epoch = value; active = enabled; post({type:'text-focus', epoch, active}); },
      result,
      close(revoke = true) { if (closed) return; if (revoke && runtime && active) runtime.ccall('touchhle_web_text_lease','number',['number','number'],[epoch,0]); closed = true; active = false; },
      handle(data) {
        if (!data || !['text-lease','text-input'].includes(data.type)) return false;
        if (closed || !runtime) return true;
        if (!integer(data.epoch) || !integer(data.lease) || data.epoch !== epoch || !active) { result(integer(data.sequence)?data.sequence:0,1); return true; }
        if (data.type === 'text-lease') {
          const status = runtime.ccall('touchhle_web_text_lease','number',['number','number'],[data.epoch,data.lease]);
          if (status) result(0,status);
          return true;
        }
        if (![data.op,data.code,data.sequence].every(integer) || data.sequence === 0) { result(0,2); return true; }
        const status = runtime.ccall('touchhle_web_text_enqueue','number',['number','number','number','number','number'],[data.epoch,data.lease,data.op,data.code,data.sequence]);
        if (status) result(data.sequence,status);
        return true;
      },
    };
  }
  function attach(worker, document = globalThis.document) {
    const panel = document.createElement('section'); panel.setAttribute('aria-label','Game text entry');
    const activate = document.createElement('button'); activate.type='button'; activate.textContent='Type in game'; activate.disabled=true;
    const input = document.createElement('input'); input.type='text'; input.setAttribute('aria-label','Type in game'); input.autocomplete='off'; input.spellcheck=false; input.disabled=true;
    const status = document.createElement('p'); status.setAttribute('role','status'); status.textContent='Text entry supports printable ASCII, Backspace and Return. Select a text field in the game first. Paste and IME are unsupported.';
    panel.append(activate,input,status); document.querySelector('#canvas').after(panel);
    let disposed=false, epoch=0, enabled=false, lease=0, nextLease=0, sequence=0, composing=false;
    const pending=new Set();
    const revoke=()=>{ if (lease) worker.postMessage({type:'text-lease',epoch,lease:0}); lease=0; input.value=''; input.disabled=true; pending.clear(); };
    const send=(op,code=0)=>{
      if(disposed||!lease||!enabled||composing||document.activeElement!==input)return;
      if(pending.size>=32||sequence>=0x7fffffff){status.textContent=reasons[6];return;}
      const id=++sequence;pending.add(id);worker.postMessage({type:'text-input',epoch,lease,op,code,sequence:id});status.textContent='Input queued for the game.';
    };
    activate.onclick=()=>{if(disposed||!enabled||nextLease>=0x7fffffff)return;revoke();composing=false;lease=++nextLease;worker.postMessage({type:'text-lease',epoch,lease});input.disabled=false;input.focus();};
    input.addEventListener('blur',revoke);
    const window = document.defaultView;
    const hidden = () => { if (document.visibilityState === 'hidden') revoke(); };
    window?.addEventListener('blur',revoke); window?.addEventListener('pagehide',revoke);
    document.addEventListener('visibilitychange',hidden);
    input.addEventListener('beforeinput',e=>{e.preventDefault();input.value='';if(e.isComposing||composing)return;
      if(e.inputType==='insertText'&&typeof e.data==='string'&&/^[\x20-\x7e]$/.test(e.data))send(0,e.data.charCodeAt(0));
      else if(e.inputType==='deleteContentBackward')send(1);
      else status.textContent='Unsupported operation: paste, IME and non-ASCII text are not entered.';
    });
    input.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key==='Backspace'){e.preventDefault();if(!e.isComposing)send(e.key==='Enter'?2:1);} });
    input.addEventListener('compositionstart',()=>{composing=true;revoke();status.textContent='IME is unsupported. Click Type in game to reactivate after composition ends.';});
    input.addEventListener('input',()=>{input.value='';});
    input.addEventListener('paste',e=>{e.preventDefault();status.textContent='Paste is unsupported; type one ASCII character at a time.';});
    input.addEventListener('drop',e=>{e.preventDefault();status.textContent='Dropped text is unsupported.';});
    const message=({data})=>{if(disposed)return;
      if(data?.type==='text-focus'&&integer(data.epoch)&&typeof data.active==='boolean'){
        revoke();epoch=data.epoch;enabled=data.active;activate.disabled=!enabled;
        status.textContent=enabled?'Click Type in game. Printable ASCII only; fewer than 256 characters.':'No supported unambiguous game text focus.';
      } else if(data?.type==='text-result'&&integer(data.sequence)&&integer(data.status)&&data.status<reasons.length){
        if(data.sequence===0||pending.delete(data.sequence))status.textContent=reasons[data.status];
      }
    };
    worker.addEventListener('message',message);
    return { dispose(){if(disposed)return;revoke();disposed=true;worker.removeEventListener('message',message);window?.removeEventListener('blur',revoke);window?.removeEventListener('pagehide',revoke);document.removeEventListener('visibilitychange',hidden);panel.remove();} };
  }
  globalThis.TouchHLEText = Object.freeze({worker,attach});
})();
