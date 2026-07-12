- make ptz camera better integrated
- keep current fullscreen interface, its good.
  - but remove the card from the vip panel
  - clean up the fullscreen interface to match the rest of the page better
  - have a clear close button
  - on desktop, have some stuff in sidebar and some stuff below the video
    - video should keep the rest of the space
  - probably make it so that the rest of the page unmounts or unloads or whatever when youre 
- make it feel more like youre switching to a different rover instead of switching to a completely different thing
- simplify and reuse components wherever possible, frontend and backend
- right now, it feels tacked on, badly integrated, and incomplete
- needs a much better UI flow
- still needs to be a VIP feature
- for users on ptz, make their chats have a rover badge that has the ptz name and a color
- make the cam show up as a room camera in the room camera panel
  - snapshot mode only
- make the ptz queue and join button show up as one roverqueuespanel style rover row below the links panel
  - only show it open for verified users, for non-verified users overlay it with a message and dont let them click on it
  - for mobile layouts, show it below the roverqueuepanel.

## ui flow should be:
1. you are verified
2. you see the ptz camera queue in the ui, it has 2 people in it
3. you click on it, the fullscreen UI opens
4. 