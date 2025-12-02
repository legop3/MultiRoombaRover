# general idea
- convert room cameras from webrtc h264 streams to 4fps jpegs sent over socket.io

## requirements
- make updated services for server and pi room cams
- no backwards compatability is needed
- room cameras are both 4:3, make sure they show as such in the UI
- remove anything related to the webRTC room cams
- send the jpegs efficiently (as binary)
- make sure the room cams are still authed as they are now