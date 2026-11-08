import { Rpc } from '../src/server/codex';
const rpc=new Rpc();
try {await rpc.initialize();console.log('Installed Codex App Server initialize/initialized handshake passed.');} finally {rpc.close();}
