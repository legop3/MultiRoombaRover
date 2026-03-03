# user verification system
## main idea
- a relatively simple system to verify trusted users and allow them to use special features
- uses IP, a cookie user ID, and nickname to verify people
- expose internally similar to socket.isAdmin: socket.isVerified.

## on-connect system to send user info to the server
- a new system in the web UI (and server a little bit probably)
- ensures that the server gets all of your user info when you connect
  - also ensures that the server can seamlessley remember who you are if you happen to lose connection and reconnect
- info contains:
  - nickname (replace the current reconnect and nickname logic with this new system)
  - cookie ID
  - more stuff in the future probably

## cookie user ID
- an ID that the server assigns to a user
- saves as a setting in the settings persistence system in the user's browser

## how will the server verify people
- when a user connects and sends their user info:
- step 1: IP address OR cookie user ID
  - if the user's IP or their cookie ID matches, continue to step 2
- step 2: nickname
  - if the user's nickname matches to it's expected step 1, the user is now verified
- the user is now verified and added to a persistent database on the server

## how will verification requests work
- user goes through the process in the web UI
- the request is DMd to lockdown admins in discord
- each message can be reacted with a check or an x emoji by the lockdown admins to accept or deny a request
- no realtime UI feedback is needed for when a request is accepted or denied

## UI specifics
- a new VIP tab in the sidebar
- either shows a button to request verification, or shows the VIP controls
### verification process
- a button in the sidebar to request verification
  - only shows if you aren't verified
- the actual process:
  1. press the button
  2. the page opens a new pop-up
  3. it explains what verification is, how it works, and that your nickname is attached to your verification
  4. prompts users to confirm their nickname, as if they change it their verification won't work
  5. a final confirmation saying that their request has been sent