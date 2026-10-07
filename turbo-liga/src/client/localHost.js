// Anfitrion en el navegador: ejecuta el mismo hub de salas que el servidor Node, dentro de la pagina.
// El anfitrion se conecta a su propio hub por un socket en memoria y los amigos por WebRTC.
import { createHub } from '../../server/hub.js';
import { startP2PHost, loopbackPair } from './p2p.js';

export async function createLocalHost(iceServers) {
  const hub = createHub({ iceServers });
  const { code, peer } = await startP2PHost(iceServers, (sock) => hub.attach(sock));
  hub.fixedCode = code;
  const [clientSock, serverSock] = loopbackPair();
  hub.attach(serverSock);
  return {
    code,
    hub,
    socket: clientSock,
    destroy() {
      try { clientSock.close(); } catch { /* */ }
      hub.shutdown();
      try { peer.destroy(); } catch { /* */ }
    },
  };
}
