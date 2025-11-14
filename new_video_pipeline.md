# video flow:
1. Raspberry pi zero 2 W
   - raspberry pi camera
     - 720p 30fps
   - hardware h264 encoder built into the pi
2. mediaMTX on the server
   - the server will forward video from the pis to users
   - video streams must be able to be locked
     - to do this, always require JWT auth for all rover streams
     - just decide who to give access tokens too
3. User web player
   - simple
   - must be able to create and manage multiple players on one page
   - reconnects automatically
   - automatically plays the video of the rover you are assigned to
   - on the spectator page:
     - show the video for all rovers, in their pane of the spectator page

# other requirements:

- absolute LOWEST LATENCY possible from glass to glass
  - probably want to use webRTC out of the pi
- MUST use mediaMTX on the server for fan-out and forwarding

# notes from past attempts:
- ffmpeg packaged for the pi doesn't have whip support built in
- it is a huge pain to get all the right gstreamer modules on the pi