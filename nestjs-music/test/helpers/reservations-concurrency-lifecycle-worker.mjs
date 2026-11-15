import { parentPort } from 'node:worker_threads';

if (parentPort === null) {
  throw new Error('Lifecycle worker requires a parent thread.');
}

parentPort.postMessage({ type: 'ready' });
parentPort.once('message', (message) => {
  if (message?.type === 'exit') {
    parentPort.close();
  }
});
