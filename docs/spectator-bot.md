# Simple spectator bot

A spectator bot connects to the rover server with Socket.IO. It can receive the current session, read chat, and send messages that are visually tagged as bot messages.

## Install

Create a small Node.js project and install the Socket.IO client:

```bash
npm install socket.io-client
```

## Example bot

Create `bot.js`:

```js
import { io } from 'socket.io-client';

// Replace this with the public URL of the MultiRoombaRover server.
const socket = io('https://your-rover-server.example', {
  // Match the transports supported by the server while retaining polling as a
  // fallback for networks or proxies that do not allow WebSocket connections.
  transports: ['websocket', 'polling'],
});

// Socket.IO acknowledgements use callbacks. This small wrapper turns them into
// promises so setup failures and rejected chat messages are easy to handle.
function emitWithAck(event, payload) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (response = {}) => {
      if (response.error) {
        reject(new Error(response.error));
        return;
      }

      resolve(response);
    });
  });
}

socket.on('connect', async () => {
  console.log('Connected:', socket.id);

  try {
    // Set the name that will appear beside this connection and its messages.
    await emitWithAck('nickname:set', {
      nickname: 'My spectator bot',
    });

    // Ask the server to make this passive connection a spectator. Performing
    // this after every connection also restores the role after a reconnect.
    await emitWithAck('session:setRole', {
      role: 'spectator',
    });

    console.log('Connected as a spectator');
  } catch (error) {
    console.error('Spectator setup failed:', error.message);
  }
});

// Each session:sync event is a complete current session snapshot. Replace any
// previously stored session with this object instead of merging snapshots.
socket.on('session:sync', (session) => {
  console.log('Session:', session);
});

// chat:init contains the recent chat history available when the bot connects.
socket.on('chat:init', (messages) => {
  console.log('Recent chat:', messages);
});

// chat:message fires whenever a new message is broadcast, including messages
// sent by this bot itself.
socket.on('chat:message', (message) => {
  console.log(`${message.nickname || 'Unknown'}: ${message.text}`);
});

socket.on('disconnect', (reason) => {
  console.log('Disconnected:', reason);
});

// Setting bot to true adds the normal bot tag to the displayed chat message.
// It does not grant the connection any additional permissions.
function sendBotMessage(text) {
  return emitWithAck('chat:send', {
    text,
    bot: true,
  });
}

// Send one example message after the connection has had time to finish setup.
// A real bot would call sendBotMessage from its own message-handling logic.
setTimeout(() => {
  sendBotMessage('Hello from my spectator bot!').catch((error) => {
    console.error('Message failed:', error.message);
  });
}, 5000);
```

Run it with:

```bash
node bot.js
```

## Events used

- `nickname:set` sets the bot's visible nickname.
- `session:setRole` changes the connection to a spectator.
- `session:sync` provides the latest complete session state.
- `chat:init` provides recent chat history after connecting.
- `chat:message` provides new chat messages.
- `chat:send` sends a chat message. Include `bot: true` to give it the bot tag.

The server can reject spectator access or a chat message. Always check the acknowledgement callback, as the example does, so those errors are not silently ignored.
