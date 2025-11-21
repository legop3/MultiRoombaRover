# general idea:
- users will be able to have and set nicknames
- a user's nickname will store in the browser using persistence.js
- the user's nickname should probably just be in socket.data.nickname
- on connection, the web UI will tell the server "this is my nickname"
  - completely enforced by the web UI
- replace any place in the web UI that shows a socket ID with the nickname
- list of users and nicknames will be sent in the session data to web clients
  - this will be used in the future for a user list and chat