import Chat from './components/Chat'
import { PipecatClient } from "@pipecat-ai/client-js";
import { PipecatClientProvider } from "@pipecat-ai/client-react";
import { WebSocketTransport } from "@pipecat-ai/websocket-transport";

const client = new PipecatClient({
  transport: new WebSocketTransport(),
  enableMic: false,
  enableCam: false,
  enableScreenShare: false,
});

function App() {
  return (
    <PipecatClientProvider client={client}>
      <Chat />
    </PipecatClientProvider>
  );
}

export default App
