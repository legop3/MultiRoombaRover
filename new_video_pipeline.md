# video flow:
1. Raspberry pi zero 2 W
   - raspberry pi camera
   - hardware h264 encoder built into the pi
2. mediaMTX on the server
   - the server will forward video from the pi to users
   - video streams must be able to be locked
     - to do this, always require JWT auth for all rover streams
     - just decide who to give access tokens too
3. User web player
   - 