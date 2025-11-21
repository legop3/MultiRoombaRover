# nicknames:
- users will be able to have and set nicknames
- a user's nickname will store in the browser using persistence.js
- the user's nickname should probably just be in socket.data.nickname
- on connection, the web UI will tell the server "this is my nickname"
  - completely enforced by the web UI
- replace any place in the web UI that shows a socket ID with the nickname
- create a small react component which can set your nickname and save it

# user list in session data:
- add a list of users to the session data for the web UI
- contains for each user:
  - socket ID
  - nickname
  - the rover that they are driving
  - their role (user, admin, lockdown, spectator)

# user list:
- a list of users
- new react component
- uses user list with nicknames from session data
- show their nickname and whether or not they are an admin

# chat:
- server side chat system:
  - don't store message history
  - emit an event to the event bus for each message
    - eventually will be forwarded to discord through a bot
  - listen to chat message events on the bus
    - eventually the discord bot will also send messages to the server chat
  - profanity filter
  - spam filter
    - repeated words
    - keymashing
    - etc
  - somehow link chat messages to rovers
    - in the future rovers will have TTS onboard, and will speak chat messages only from the person driving the rover
- chat on the UI
  - new react component
  - show messages as they come in:
    - time (just like 19:23), sender nickname, rover they are driving, message
  - pressing enter on the keyboard will pause rover control, and focus the chat box.
    - pressing enter again after typing will send the message


# layout and styling for new UI elements:
- use index.css styles to match the new stuff to the current UI
- just edit the desktop page for now
- layout:
  - in the left column, a new row in between video and logs
  - 50/50 split between:
    - user list and nickname entry
    - chat history and chat box