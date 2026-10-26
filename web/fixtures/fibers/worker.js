// SPDX-License-Identifier: MPL-2.0
const adapter = new URL(self.location).searchParams.has('adapter');
importScripts(adapter ? './fiber-adapter-checks.js' : './fiber-checks.js');
const create = adapter ? createFiberAdapterChecks : createFiberChecks;
create({
  print: message => self.postMessage({ message }),
  printErr: message => self.postMessage({ error: message }),
  onAbort: message => self.postMessage({ error: String(message) }),
}).catch(error => self.postMessage({ error: String(error) }));
